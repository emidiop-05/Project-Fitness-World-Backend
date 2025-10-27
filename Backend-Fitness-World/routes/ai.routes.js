const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");

console.log("✅ AI routes loaded");

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY;
const PREFERRED = process.env.HF_MODEL;

const FALLBACKS = [
  "meta-llama/Llama-3.2-1B-Instruct",
  "microsoft/Phi-3-mini-4k-instruct",
  "Qwen/Qwen2.5-0.5B-Instruct",
  "HuggingFaceH4/zephyr-7b-beta",
  "google/gemma-2-2b-it",
].filter(Boolean);

const ENDPOINT = "https://router.huggingface.co/hf-inference";

function ensureSystem(messages, sys) {
  return messages.some((m) => m.role === "system")
    ? messages
    : [{ role: "system", content: sys }, ...messages];
}

async function tryModel(body, model) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: body.messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      parameters: {
        temperature: body.temperature,
        max_new_tokens: body.max_tokens,
        top_p: body.top_p,
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`[${response.status}] ${text}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return String(text || "").trim();
  }

  return (
    data?.generated_text ||
    data?.outputs?.[0]?.content?.[0]?.text ||
    "I couldn't generate a response right now."
  );
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
        console.warn("[AI] model failed:", m, String(e).slice(0, 200));
        continue;
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
