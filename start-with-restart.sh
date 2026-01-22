#!/bin/bash

# Auto-restart script for dashboard server
# This script monitors the server and restarts it automatically if it crashes

MAX_RESTARTS=10
RESTART_COUNT=0
RESTART_WINDOW=3600  # 1 hour in seconds

echo "🚀 Starting dashboard server with auto-restart..."
echo "📊 Max restarts: $MAX_RESTARTS per hour"
echo ""

# Track restart times
declare -a RESTART_TIMES

while true; do
  # Clean up old restart times (older than 1 hour)
  CURRENT_TIME=$(date +%s)
  NEW_TIMES=()
  for time in "${RESTART_TIMES[@]}"; do
    if [ $((CURRENT_TIME - time)) -lt $RESTART_WINDOW ]; then
      NEW_TIMES+=("$time")
    fi
  done
  RESTART_TIMES=("${NEW_TIMES[@]}")
  
  # Check if we've hit restart limit
  if [ ${#RESTART_TIMES[@]} -ge $MAX_RESTARTS ]; then
    echo "❌ ERROR: Too many restarts (${#RESTART_TIMES[@]}) in the last hour"
    echo "⚠️  Please check server logs and fix the underlying issue"
    exit 1
  fi
  
  # Start the server with memory limit and garbage collection
  echo "▶️  Starting server (attempt $((${#RESTART_TIMES[@]} + 1)))"
  node --max-old-space-size=512 --expose-gc server.js
  
  EXIT_CODE=$?
  RESTART_TIMES+=("$(date +%s)")
  
  echo ""
  echo "⚠️  Server exited with code $EXIT_CODE at $(date)"
  echo "🔄 Restarting in 3 seconds..."
  echo "📊 Restarts in last hour: ${#RESTART_TIMES[@]}/$MAX_RESTARTS"
  echo ""
  
  sleep 3
done

