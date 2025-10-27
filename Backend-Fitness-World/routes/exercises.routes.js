const express = require("express");
const router = express.Router();

const BASE = "https://exercisedb.p.rapidapi.com";

// === Config ===
function headers() {
  if (!process.env.RAPIDAPI_KEY) throw new Error("Missing RAPIDAPI_KEY");
  return {
    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
    "x-rapidapi-host": process.env.RAPIDAPI_HOST || "exercisedb.p.rapidapi.com",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// === Helpers ===
function withGif(ex) {
  const id = ex?.id || ex?.uuid || ex?.name;
  const fallback = id
    ? `https://v2.exercisedb.io/image/${encodeURIComponent(id)}.gif`
    : null;
  return {
    ...ex,
    gifUrl: ex.gifUrl || ex.image || ex.imageUrl || fallback,
  };
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function buildDay(name, list, label) {
  return {
    name,
    blocks: (list || []).map((ex) => ({
      id: ex.id || ex.name,
      name: ex.name,
      equipment: ex.equipment || "body weight",
      target: ex.target || label,
      gifUrl: ex.gifUrl,
      sets: 3,
      reps: 8,
      restSec: 90,
    })),
  };
}

function dedup(list) {
  const seen = new Set();
  return (list || []).filter((ex) => {
    const key = ex.id || ex.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function safeFetch(url) {
  try {
    const r = await fetch(url, { headers: headers() });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || "bad response");
    return Array.isArray(data) ? data.map(withGif) : [];
  } catch (e) {
    console.warn("⚠️ fetch fail", url, e.message);
    return [];
  }
}

/** Normalize various synonyms to ExerciseDB's exact target keys */
const TARGET_ALIASES = Object.freeze({
  // Chest
  "pectoralis major": "pectorals",
  pectorals: "pectorals",

  // Back
  "latissimus dorsi": "lats",
  lats: "lats",
  "upper back": "upper back",
  trapezius: "traps",
  traps: "traps",
  spine: "spine",
  "levator scapulae": "levator scapulae",

  // Shoulders
  deltoids: "delts",
  delts: "delts",

  // Arms
  "biceps brachii": "biceps",
  biceps: "biceps",
  "triceps brachii": "triceps",
  triceps: "triceps",
  forearms: "forearms",

  // Core
  abdominals: "abs",
  abs: "abs",
  obliques: "obliques",

  // Legs
  quadriceps: "quads",
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  adductors: "adductors",
  abductors: "abductors",

  // Cardio
  "cardiovascular system": "cardiovascular system",
});

function normalizeTarget(t) {
  const key = String(t || "")
    .trim()
    .toLowerCase();
  // find exact alias (case-insensitive)
  for (const [raw, normalized] of Object.entries(TARGET_ALIASES)) {
    if (raw.toLowerCase() === key) return normalized;
  }
  // fall back to whatever was provided
  return t;
}

async function fetchTargets(targets) {
  const results = [];
  for (const t of targets) {
    const normalized = normalizeTarget(t);
    const url = `${BASE}/exercises/target/${encodeURIComponent(normalized)}`;
    const data = await safeFetch(url);
    results.push(...data);
    await sleep(250); // throttle to avoid rate limits
  }
  return dedup(results);
}

// === Groups & Areas ===
// Use the EXACT strings ExerciseDB expects (left side are our “display” names; right side are API target keys)
const GROUPS = {
  Chest: ["pectorals", "serratus anterior"],
  Back: ["lats", "upper back", "traps", "spine", "levator scapulae"],
  Shoulders: ["delts"],
  Arms: ["biceps", "triceps", "forearms"],
  Core: ["abs", "obliques"],
  Legs: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  Cardio: ["cardiovascular system"],
};

// Larger areas aggregate groups above
const AREAS = {
  UpperBody: ["Chest", "Back", "Shoulders", "Arms"],
  LowerBody: ["Core", "Legs"],
  FullBody: ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs", "Cardio"],
};

// === ROUTES ===

// Quick health check
router.get("/health", async (_req, res) => {
  try {
    const r = await fetch(`${BASE}/exercises/targetList`, {
      headers: headers(),
    });
    const ok = r.ok;
    const host = process.env.RAPIDAPI_HOST || "exercisedb.p.rapidapi.com";
    res.json({ ok, host, note: "If ok=false, check RAPIDAPI_KEY/host." });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// List all groups (used by Plans page)
router.get("/groups", (_req, res) => {
  res.json(
    Object.entries(GROUPS).map(([group, targets]) => ({ group, targets }))
  );
});

// List exercises for a single group
router.get("/group/:group", async (req, res) => {
  const groupParam = (req.params.group || "").toLowerCase();
  const entry = Object.entries(GROUPS).find(
    ([g]) => g.toLowerCase() === groupParam
  );
  if (!entry)
    return res
      .status(404)
      .json({ error: `Unknown group "${req.params.group}"` });

  const [groupName, targets] = entry;
  const limit = Math.min(parseInt(req.query.limit || "40", 10), 100);
  const offset = parseInt(req.query.offset || "0", 10);

  try {
    const merged = await fetchTargets(targets);
    const slice = merged.slice(offset, offset + limit);
    res.json({
      group: groupName,
      targets,
      total: merged.length,
      limit,
      offset,
      results: slice,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching group" });
  }
});

// Build 3-day plan for a single group
router.get("/plans/group/:group", async (req, res) => {
  const groupParam = (req.params.group || "").toLowerCase();
  const entry = Object.entries(GROUPS).find(
    ([g]) => g.toLowerCase() === groupParam
  );
  if (!entry)
    return res
      .status(404)
      .json({ error: `Unknown group "${req.params.group}"` });

  const [groupName, targets] = entry;

  try {
    const merged = shuffle(await fetchTargets(targets));
    const chunk = Math.ceil(merged.length / 3) || 5;
    const days = [
      buildDay("Day 1", merged.slice(0, chunk), groupName),
      buildDay("Day 2", merged.slice(chunk, chunk * 2), groupName),
      buildDay("Day 3", merged.slice(chunk * 2, chunk * 3), groupName),
    ];
    res.json({ group: groupName, targets, days });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error building group plan" });
  }
});

// List areas
router.get("/areas", (_req, res) => {
  res.json(Object.entries(AREAS).map(([area, groups]) => ({ area, groups })));
});

// List exercises for an area
router.get("/area/:area", async (req, res) => {
  const areaParam = (req.params.area || "").toLowerCase();
  const entry = Object.entries(AREAS).find(
    ([a]) => a.toLowerCase() === areaParam
  );
  if (!entry)
    return res.status(404).json({ error: `Unknown area "${req.params.area}"` });

  const [areaName, groups] = entry;
  const allTargets = groups.flatMap((g) => GROUPS[g] || []);
  const limit = Math.min(parseInt(req.query.limit || "60", 10), 120);
  const offset = parseInt(req.query.offset || "0", 10);

  try {
    const merged = await fetchTargets(allTargets);
    const slice = merged.slice(offset, offset + limit);
    res.json({
      area: areaName,
      groups,
      total: merged.length,
      limit,
      offset,
      results: slice,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching area" });
  }
});

// Build 3-day plan for an area
router.get("/plans/area/:area", async (req, res) => {
  const areaParam = (req.params.area || "").toLowerCase();
  const entry = Object.entries(AREAS).find(
    ([a]) => a.toLowerCase() === areaParam
  );
  if (!entry)
    return res.status(404).json({ error: `Unknown area "${req.params.area}"` });

  const [areaName, groups] = entry;
  const allTargets = groups.flatMap((g) => GROUPS[g] || []);

  try {
    const merged = shuffle(await fetchTargets(allTargets));

    if (merged.length === 0) {
      return res.json({
        area: areaName,
        message: "No exercises available for this area right now.",
        days: [
          buildDay("Day 1", [], areaName),
          buildDay("Day 2", [], areaName),
          buildDay("Day 3", [], areaName),
        ],
      });
    }

    const chunk = Math.ceil(merged.length / 3);
    const days = [
      buildDay("Day 1", merged.slice(0, chunk), areaName),
      buildDay("Day 2", merged.slice(chunk, chunk * 2), areaName),
      buildDay("Day 3", merged.slice(chunk * 2), areaName),
    ];

    res.json({ area: areaName, groups, total: merged.length, days });
  } catch (e) {
    console.error("❌ Area plan error:", e);
    res
      .status(500)
      .json({ error: "Internal error building plan", details: e.message });
  }
});

// Single exercise
router.get("/exercise/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await fetch(
      `${BASE}/exercises/exercise/${encodeURIComponent(id)}`,
      { headers: headers() }
    );
    const data = await r.json();
    if (!r.ok)
      return res
        .status(r.status)
        .json({ error: data?.message || "Failed to fetch exercise" });
    const exercise = Array.isArray(data) ? data[0] : data;
    if (!exercise) return res.status(404).json({ error: "Exercise not found" });
    return res.json(withGif(exercise));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching exercise" });
  }
});

// passthrough: target list
router.get("/targets", async (_req, res) => {
  try {
    const r = await fetch(`${BASE}/exercises/targetList`, {
      headers: headers(),
    });
    const data = await r.json();
    if (!r.ok)
      return res
        .status(r.status)
        .json({ error: data?.message || "Failed to fetch targets" });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching targets" });
  }
});

// passthrough: exercises by target
router.get("/target/:muscle", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
  const offset = parseInt(req.query.offset || "0", 10);

  try {
    const mus = normalizeTarget(req.params.muscle);
    const all = await safeFetch(
      `${BASE}/exercises/target/${encodeURIComponent(mus)}`
    );
    const slice = all.slice(offset, offset + limit);
    res.json({ total: all.length, limit, offset, results: slice });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching exercises" });
  }
});

module.exports = router;
