const express = require("express");
const router = express.Router();

const doFetch =
  (globalThis && globalThis.fetch && globalThis.fetch.bind(globalThis)) ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY;
const PREFERRED = process.env.HF_MODEL;
const ENDPOINT = "https://router.huggingface.co/v1/chat/completions";

const FALLBACKS = [
  "meta-llama/Llama-3.1-8B-Instruct:cerebras", // known good for you
  "mistralai/Mistral-7B-Instruct-v0.3:fireworks",
  "Qwen/Qwen2.5-7B-Instruct:together",
];

function ensureSystem(messages, sys) {
  return messages.some((m) => m.role === "system")
    ? messages
    : [{ role: "system", content: sys }, ...messages];
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
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      top_p: body.top_p,
      stream: false,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(t));

  const raw = await res.text();
  if (!res.ok) {
    let hint = "";
    if (res.status === 401) hint = " (check HF token + provider permissions)";
    if (res.status === 429)
      hint = " (rate limit—slow down or pick another provider)";
    throw new Error(`[${res.status}] ${raw}${hint}`);
  }

  const data = JSON.parse(raw);
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
      model,
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

    const candidates = [model || PREFERRED, ...FALLBACKS].filter(Boolean);

    let lastErr = null;
    for (const m of candidates) {
      try {
        console.log("[AI] trying model:", m);
        const reply = await tryModel(body, m);
        return res.json({ reply, model: m });
      } catch (e) {
        lastErr = e;
        console.warn("[AI] model failed:", m, String(e).slice(0, 300));
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
