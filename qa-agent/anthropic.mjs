// Minimal Anthropic Messages API client via built-in fetch (no SDK dependency).
import { config } from "./config.mjs";

/**
 * Calls the Messages API and returns the concatenated text output.
 * Retries on transient (429/5xx) errors with backoff.
 */
export async function complete({ model, system, messages, maxTokens = 2000, temperature }) {
  const body = { model, max_tokens: maxTokens, system, messages };
  // Some newer models reject `temperature`. Only send it when explicitly asked.
  if (typeof temperature === "number") body.temperature = temperature;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": config.anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Anthropic HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 300)}`);
      }
      const data = await res.json();
      return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Parses a JSON object out of a model response, tolerating ```json fences and prose. */
export function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Grab the outermost {...} if there is surrounding prose.
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
