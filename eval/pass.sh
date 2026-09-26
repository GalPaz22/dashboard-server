#!/usr/bin/env bash
# Runs the eval corpus against freshly started servers, one server per pass.
#
# Passes must not share a process: the translation and embedding variance the
# harness exists to measure is per process, so reusing one server hides it.
#
#   eval/pass.sh base 3 --stores garmin
#
# writes snapshots base1..base3. Any extra arguments go to `search-eval.mjs run`.

set -uo pipefail

LABEL="${1:?usage: eval/pass.sh <label-prefix> <passes> [run args...]}"
PASSES="${2:?usage: eval/pass.sh <label-prefix> <passes> [run args...]}"
shift 2

PORT="${PORT:-8099}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

free_port() {
  local pid
  for _ in $(seq 1 30); do
    pid="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
    [ -z "$pid" ] && return 0
    kill $pid 2>/dev/null || true
    sleep 1
  done
  echo "port $PORT still held by $(lsof -ti tcp:"$PORT")" >&2
  return 1
}

for n in $(seq 1 "$PASSES"); do
  free_port || exit 1

  PORT="$PORT" node server.js > "/tmp/eval_${LABEL}${n}.log" 2>&1 &
  srv=$!

  ready=""
  for _ in $(seq 1 90); do
    # A dead child means the server failed to boot; waiting the full 90s for a
    # process that will never answer just produces a snapshot of 500s.
    if ! kill -0 "$srv" 2>/dev/null; then
      echo "server exited during startup — see /tmp/eval_${LABEL}${n}.log" >&2
      tail -20 "/tmp/eval_${LABEL}${n}.log" >&2
      exit 1
    fi
    if curl -sf -m 2 -o /dev/null "http://localhost:${PORT}/health"; then ready=1; break; fi
    sleep 1
  done
  [ -n "$ready" ] || { echo "server never became healthy on :$PORT" >&2; kill $srv 2>/dev/null; exit 1; }
  sleep 2

  node eval/search-eval.mjs run --label "${LABEL}${n}" --url "http://localhost:${PORT}" "$@"
  status=$?

  kill $srv 2>/dev/null || true
  wait $srv 2>/dev/null || true

  [ $status -eq 0 ] || { echo "pass ${LABEL}${n} failed" >&2; exit $status; }
done
