// Central config for the QA Agent. Loads .env from the project root and exposes
// run-time constants. No domain/keyword constants live here — the agent is
// intentionally domain-agnostic and derives everything from per-store data.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env sits one level up, in the project root.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[qa-agent] Missing required env var: ${name} (expected in project .env)`);
    process.exit(1);
  }
  return v;
}

export const config = {
  mongodbUri: requireEnv("MONGODB_URI"),
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),

  // Live search server. server.js listens on PORT (defaults to 8080).
  baseUrl: process.env.QA_BASE_URL || `http://localhost:${process.env.PORT || 8080}`,

  // The core account DB and collection that hold every store's config.
  usersDb: "users",
  usersCollection: "users",

  // Models: cheap+fast for high-volume grading, strong for the rarer diagnose/fix step.
  models: {
    grade: process.env.QA_GRADE_MODEL || "claude-sonnet-4-6",
    diagnose: process.env.QA_DIAGNOSE_MODEL || "claude-opus-4-8",
  },

  // Query-set sizing (per store).
  querySet: {
    recent: Number(process.env.QA_RECENT || 15), // last N searches from queries collection
    frequent: Number(process.env.QA_FREQUENT || 10), // top N most-frequent searches
    popular: Number(process.env.QA_POPULAR || 10), // top N clicked products (searched by name)
    cap: Number(process.env.QA_CAP || 30), // hard cap on total queries tested per store
  },

  // How many products to show the judge and to probe as "should-have-matched" candidates.
  topK: Number(process.env.QA_TOPK || 10),
  probeK: Number(process.env.QA_PROBEK || 12),

  // Parallelism / resilience.
  concurrency: Number(process.env.QA_CONCURRENCY || 3),
  requestTimeoutMs: Number(process.env.QA_TIMEOUT_MS || 30000),
  retries: Number(process.env.QA_RETRIES || 2),

  reportsDir: path.join(__dirname, "reports"),
};

export const paths = { root: path.join(__dirname, ".."), agent: __dirname };
