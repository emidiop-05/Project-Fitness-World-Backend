// ai.routes.js — Robust provider/model fallback for Hugging Face Router (OpenAI-style)

const express = require("express");
const router = express.Router();

// Use Node 18+ global fetch if available; otherwise, load node-fetch dynamically
const doFetch =
  (globalThis && globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY; // required
const PREFERRED = process.env.HF_MODEL; // optional, can include provider suffix, e.g. "meta-llama/Llama-3.1-8B-Instruct:cerebras"

const ENDPOINT = "https://router.huggingface.co/v1/chat/completions";

// Base chat-capable models that are commonly available across providers.
// (We’ll try each with several providers below.)
const BASE_MODELS = [
  // compact + capable
  "meta-llama/Llama-3.1-8B-Instruct",
  "Qwen/Qwen2.5-7B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "google/gemma-2-9b-it",
];

// Providers to try. Your HF token must have these providers enabled in “Inference Providers”.
// We include several; the router will return 400 if unsupported, and we’ll move on.
const PROVIDERS = [
  "cerebras",
  "together",
  "fireworks",
  "replicate",
  "hf-inference", // last (often limited support for many chat models)
];

function ensureSystem(messages, sys) {
  return messages.some((m) => m.role === "system")
    ? messages
    : [{ role: "system", content: sys }, ...messages];
}

// Expand a model or preferred string into a list of provider-qualified candidates.
// - If user/PREFERRED includes a provider suffix (contains ":"), use it as-is.
// - Otherwise, try appending each provider from PROVIDERS.
function expandCandidates(preferred) {
  const list = [];

  if (preferred) {
    if (preferred.includes(":")) {
      list.push(preferred); // already provider-qualified
    } else {
      for (const p of PROVIDERS) list.push(`${preferred}:${p}`);
    }
  }

  for (const base of BASE_MODELS) {
    for (const p of PROVIDERS) list.push(`${base}:${p}`);
  }

  // Deduplicate while preserving order
  return [...new Set(list)];
}

async function tryModel(body, model) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25_000);

  const res = await doFetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: body.messages, // OpenAI-style messages
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      top_p: body.top_p,
      stream: false,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(t));

  const raw = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${raw}`);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return (
      String(raw || "").trim() || "I couldn't generate a response right now."
    );
  }

  const reply = data?.choices?.[0]?.message?.content;
  return (reply || "I couldn't generate a response right now.")
    .toString()
    .trim();
}

router.post("/chat", async (req, res) => {
  try {
    if (!HF_API_KEY) {
      return res.status(501).json({
        error: "AI not configured: missing HUGGINGFACE_API_KEY or HF_API_KEY",
      });
    }

    const {
      messages = [],
      model, // optional override from client
      max_tokens = 256,
      temperature = 0.7,
      top_p = 1,
    } = req.body || {};

    const body = {
      messages: ensureSystem(
        messages,
        "You are a helpful assistant for the Fitness World app."
      ),
      temperature,
      max_tokens: Math.min(1024, max_tokens),
      top_p,
    };

    // Build candidate list: user-provided model (if any), then PREFERRED env, then our base fallbacks,
    // each expanded across multiple providers.
    const candidates = expandCandidates(model || PREFERRED);

    let lastErr = null;
    for (const m of candidates) {
      try {
        console.log("[AI] trying model:", m);
        const reply = await tryModel(body, m);
        return res.json({ reply, model: m });
      } catch (e) {
        lastErr = e;
        console.warn("[AI] model failed:", m, String(e).slice(0, 300));
        // Continue to next candidate
      }
    }

    return res.status(502).json({
      error: "No supported model available for your providers",
      details: String(lastErr || "No candidates"),
      tried: candidates,
    });
  } catch (err) {
    console.error("[AI] /chat error:", err);
    return res
      .status(500)
      .json({ error: "Internal server error", details: String(err) });
  }
});

module.exports = router;
