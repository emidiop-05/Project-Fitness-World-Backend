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
  return { ...ex, gifUrl: ex.gifUrl || ex.image || ex.imageUrl || fallback };
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
  return list.filter((ex) => {
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

// === Groups & Areas ===
const GROUPS = {
  Chest: ["pectorals", "serratus anterior"],
  Back: ["lats", "upper back", "traps"],
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

// === Fetch utilities ===
async function fetchTargets(targets) {
  const results = [];
  for (const t of targets) {
    const data = await safeFetch(
      `${BASE}/exercises/target/${encodeURIComponent(t)}`
    );
    results.push(...data);
    await sleep(250); // throttle a bit
  }
  return dedup(results);
}

// === ROUTES ===
router.get("/areas", (_req, res) => {
  res.json(Object.entries(AREAS).map(([area, groups]) => ({ area, groups })));
});

router.get("/plans/area/:area", async (req, res) => {
  const areaParam = (req.params.area || "").toLowerCase();
  const entry = Object.entries(AREAS).find(
    ([a]) => a.toLowerCase() === areaParam
  );

  if (!entry) {
    return res.status(404).json({ error: `Unknown area "${req.params.area}"` });
  }

  const areaName = entry[0];
  const groups = entry[1];
  const allTargets = groups.flatMap((g) => GROUPS[g] || []);

  try {
    const exercises = await fetchTargets(allTargets);
    if (exercises.length === 0) {
      console.warn(`⚠️ No data returned for ${areaName}`);
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

    const shuffled = shuffle(exercises);
    const chunk = Math.ceil(shuffled.length / 3);
    const days = [
      buildDay("Day 1", shuffled.slice(0, chunk), areaName),
      buildDay("Day 2", shuffled.slice(chunk, chunk * 2), areaName),
      buildDay("Day 3", shuffled.slice(chunk * 2), areaName),
    ];

    res.json({ area: areaName, groups, total: exercises.length, days });
  } catch (e) {
    console.error("❌ Area plan error:", e);
    res
      .status(500)
      .json({ error: "Internal error building plan", details: e.message });
  }
});

module.exports = router;
