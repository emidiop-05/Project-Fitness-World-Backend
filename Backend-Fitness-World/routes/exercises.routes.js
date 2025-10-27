// routes/exercises.routes.js
const express = require("express");
const router = express.Router();

const BASE = "https://exercisedb.p.rapidapi.com";

/* =========================
   Config
   ========================= */
function headers() {
  if (!process.env.RAPIDAPI_KEY) throw new Error("Missing RAPIDAPI_KEY");
  return {
    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
    "x-rapidapi-host": process.env.RAPIDAPI_HOST || "exercisedb.p.rapidapi.com",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================
   Helpers
   ========================= */
function withGif(ex) {
  const id = ex?.id || ex?.uuid || ex?.name;
  const fallback = id
    ? `https://v2.exercisedb.io/image/${encodeURIComponent(id)}.gif`
    : null;
  return { ...ex, gifUrl: ex.gifUrl || ex.image || ex.imageUrl || fallback };
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
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

/** Map synonyms → ExerciseDB's exact target keys */
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
  for (const [raw, normalized] of Object.entries(TARGET_ALIASES)) {
    if (raw.toLowerCase() === key) return normalized;
  }
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

/* -------- Volume & plan building -------- */
function getVolume(req) {
  const intensity = String(req.query.intensity || "standard").toLowerCase();
  const presets = {
    easy: { sets: 2, reps: 8, restSec: 60, perDay: 4, days: 3 },
    standard: { sets: 3, reps: 10, restSec: 90, perDay: 6, days: 3 },
    hard: { sets: 4, reps: 8, restSec: 120, perDay: 8, days: 3 },
  };
  const base = presets[intensity] || presets.standard;

  return {
    sets: parseInt(req.query.sets || base.sets, 10),
    reps: parseInt(req.query.reps || base.reps, 10),
    restSec: parseInt(req.query.restSec || base.restSec, 10),
    perDay: Math.min(parseInt(req.query.perDay || base.perDay, 10), 12),
    days: Math.min(parseInt(req.query.days || base.days, 10), 6),
  };
}

function buildDay(name, list, label, vol) {
  return {
    name,
    blocks: (list || []).map((ex) => ({
      id: ex.id || ex.name,
      name: ex.name,
      equipment: ex.equipment || "body weight",
      target: ex.target || label,
      gifUrl: ex.gifUrl,
      sets: vol.sets,
      reps: vol.reps,
      restSec: vol.restSec,
    })),
  };
}

/** Distribute exercises across days, balanced by target (round-robin) and capped per day */
function buildBalancedDays(exercises, { days = 3, perDay = 6 } = {}) {
  const buckets = exercises.reduce((acc, ex) => {
    const key = (ex.target || "other").toLowerCase();
    (acc[key] ||= []).push(ex);
    return acc;
  }, {});
  Object.values(buckets).forEach((arr) => arr.sort(() => Math.random() - 0.5));

  const result = Array.from({ length: days }, () => []);
  const bucketKeys = Object.keys(buckets);

  while (bucketKeys.length) {
    for (const key of [...bucketKeys]) {
      const ex = buckets[key].pop();
      if (ex) {
        // place into next day with capacity
        let placed = false;
        for (let d = 0; d < days; d++) {
          if (result[d].length < perDay) {
            result[d].push(ex);
            placed = true;
            break;
          }
        }
        if (!placed) return result; // all days full
      } else {
        const idx = bucketKeys.indexOf(key);
        if (idx >= 0) bucketKeys.splice(idx, 1);
      }
    }
  }
  return result;
}

/* =========================
   Groups & Areas (ExerciseDB keys)
   ========================= */
const GROUPS = {
  Chest: ["pectorals", "serratus anterior"],
  Back: ["lats", "upper back", "traps", "spine", "levator scapulae"],
  Shoulders: ["delts"],
  Arms: ["biceps", "triceps", "forearms"],
  Core: ["abs", "obliques"],
  Legs: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  Cardio: ["cardiovascular system"],
};

const AREAS = {
  UpperBody: ["Chest", "Back", "Shoulders", "Arms"],
  LowerBody: ["Core", "Legs"],
  FullBody: ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs", "Cardio"],
};

/* =========================
   Routes
   ========================= */

// Health check
router.get("/health", async (_req, res) => {
  try {
    const r = await fetch(`${BASE}/exercises/targetList`, {
      headers: headers(),
    });
    res.json({
      ok: r.ok,
      host: process.env.RAPIDAPI_HOST || "exercisedb.p.rapidapi.com",
      note: "If ok=false, verify RAPIDAPI_KEY and host.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// List groups
router.get("/groups", (_req, res) => {
  res.json(
    Object.entries(GROUPS).map(([group, targets]) => ({ group, targets }))
  );
});

// Exercises for a group
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

// 3-day (configurable) plan for a group
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
  const vol = getVolume(req);

  try {
    const merged = shuffle(await fetchTargets(targets));
    if (merged.length === 0) {
      return res.json({
        group: groupName,
        message: "No exercises available for this group right now.",
        days: Array.from({ length: vol.days }, (_, i) =>
          buildDay(`Day ${i + 1}`, [], groupName, vol)
        ),
        volume: vol,
      });
    }

    const dayLists = buildBalancedDays(merged, {
      days: vol.days,
      perDay: vol.perDay,
    });
    const days = dayLists.map((list, i) =>
      buildDay(`Day ${i + 1}`, list, groupName, vol)
    );

    res.json({
      group: groupName,
      targets,
      total: merged.length,
      days,
      volume: vol,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error building group plan" });
  }
});

// List areas
router.get("/areas", (_req, res) => {
  res.json(Object.entries(AREAS).map(([area, groups]) => ({ area, groups })));
});

// Exercises for an area
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

// 3-day (configurable) plan for an area
router.get("/plans/area/:area", async (req, res) => {
  const areaParam = (req.params.area || "").toLowerCase();
  const entry = Object.entries(AREAS).find(
    ([a]) => a.toLowerCase() === areaParam
  );
  if (!entry)
    return res.status(404).json({ error: `Unknown area "${req.params.area}"` });

  const [areaName, groups] = entry;
  const allTargets = groups.flatMap((g) => GROUPS[g] || []);
  const vol = getVolume(req);

  try {
    const merged = shuffle(await fetchTargets(allTargets));

    if (merged.length === 0) {
      return res.json({
        area: areaName,
        message: "No exercises available for this area right now.",
        days: Array.from({ length: vol.days }, (_, i) =>
          buildDay(`Day ${i + 1}`, [], areaName, vol)
        ),
        volume: vol,
      });
    }

    const dayLists = buildBalancedDays(merged, {
      days: vol.days,
      perDay: vol.perDay,
    });
    const days = dayLists.map((list, i) =>
      buildDay(`Day ${i + 1}`, list, areaName, vol)
    );

    res.json({
      area: areaName,
      groups,
      total: merged.length,
      days,
      volume: vol,
    });
  } catch (e) {
    console.error("❌ Area plan error:", e);
    res
      .status(500)
      .json({ error: "Internal error building plan", details: e.message });
  }
});

// Single exercise by ID
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

// Passthrough: target list
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

// Passthrough: exercises by target
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
