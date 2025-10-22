// routes/exercises.routes.js
const express = require("express");
const router = express.Router();
const BASE = "https://exercisedb.p.rapidapi.com";

function headers() {
  if (!process.env.RAPIDAPI_KEY) throw new Error("Missing RAPIDAPI_KEY");
  return {
    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
    "x-rapidapi-host": process.env.RAPIDAPI_HOST || "exercisedb.p.rapidapi.com",
  };
}

/** ✅ ensure we always have a gifUrl */
function withGif(ex) {
  const id = ex?.id || ex?._id || ex?.uuid || ex?.name || "";
  const fallback = id
    ? `https://v2.exercisedb.io/image/${encodeURIComponent(id)}.gif`
    : null;
  return {
    ...ex,
    gifUrl: ex.gifUrl || ex.image || ex.imageUrl || fallback,
  };
}

/** 👇 Group → targets mapping (unchanged) */
const GROUPS = {
  Chest: ["pectorals", "serratus anterior"],
  Back: ["lats", "upper back", "traps", "spine", "levator scapulae"],
  Shoulders: ["delts"],
  Arms: ["biceps", "triceps", "forearms"],
  Core: ["abs", "obliques", "adductors"],
  Legs: ["quads", "hamstrings", "glutes", "calves", "abductors"],
  Cardio: ["cardiovascular system"],
};

/** helper: fetch all exercises for a target */
async function fetchByTarget(target) {
  const r = await fetch(
    `${BASE}/exercises/target/${encodeURIComponent(target)}`,
    {
      headers: headers(),
    }
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `Failed target ${target}`);
  const list = Array.isArray(data) ? data : [];
  // ✅ normalize gifs for every item
  return list.map(withGif);
}

/** helper: simple shuffle */
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

/** helper: build a day from exercises (kept same, your logic intact) */
function buildDay(name, list, muscleLabel) {
  return {
    name,
    blocks: list.map((ex) => ({
      id: ex.id || ex.name,
      name: ex.name,
      equipment: ex.equipment || "body weight",
      target: ex.target || muscleLabel,
      // ✅ keep your precedence, already ensured by withGif as well
      gifUrl: ex.gifUrl || ex.image || ex.imageUrl || null,
      sets: 3,
      reps: 8,
      restSec: 90,
    })),
  };
}

/** --- existing endpoints you already have --- */
// GET /api/exercises/targets
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

// GET /api/exercises/exercise/:id
router.get("/exercise/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await fetch(
      `${BASE}/exercises/exercise/${encodeURIComponent(id)}`,
      {
        headers: headers(),
      }
    );
    const data = await r.json();
    if (!r.ok)
      return res
        .status(r.status)
        .json({ error: data?.message || "Failed to fetch exercise" });
    const exercise = Array.isArray(data) ? data[0] : data;
    if (!exercise) return res.status(404).json({ error: "Exercise not found" });
    // ✅ ensure gif present
    return res.json(withGif(exercise));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching exercise" });
  }
});

router.get("/target/:muscle", async (req, res) => {
  const { muscle } = req.params;
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
  const offset = parseInt(req.query.offset || "0", 10);

  try {
    const r = await fetch(
      `${BASE}/exercises/target/${encodeURIComponent(muscle)}`,
      {
        headers: headers(),
      }
    );
    const allRaw = await r.json();
    if (!r.ok)
      return res
        .status(r.status)
        .json({ error: allRaw?.message || "Failed to fetch exercises" });

    const all = (Array.isArray(allRaw) ? allRaw : []).map(withGif); // ✅ normalize
    const slice = all.slice(offset, offset + limit);
    res.json({ total: all.length, limit, offset, results: slice });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching exercises" });
  }
});

// GET /api/exercises/plans/:muscle
router.get("/plans/:muscle", async (req, res) => {
  const { muscle } = req.params;

  try {
    const r = await fetch(
      `${BASE}/exercises/target/${encodeURIComponent(muscle)}`,
      {
        headers: headers(),
      }
    );
    const raw = await r.json();
    if (!r.ok)
      return res
        .status(r.status)
        .json({ error: raw?.message || "Failed to fetch exercises" });

    const exercises = (Array.isArray(raw) ? raw : []).map(withGif); // ✅ normalize
    const shuffled = shuffle(exercises);
    const pick = (arr, n) => arr.slice(0, n);
    const day1 = pick(shuffled, 4);
    const day2 = pick(shuffled.slice(4), 4);
    const day3 = pick(shuffled.slice(8), 4);

    res.json({
      muscle,
      days: [
        buildDay("Day 1", day1, muscle),
        buildDay("Day 2", day2, muscle),
        buildDay("Day 3", day3, muscle),
      ],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error creating plan" });
  }
});

// GET /api/exercises/groups
router.get("/groups", (_req, res) => {
  res.json(
    Object.entries(GROUPS).map(([group, targets]) => ({ group, targets }))
  );
});

// GET /api/exercises/group/:group
router.get("/group/:group", async (req, res) => {
  const groupParam = (req.params.group || "").toLowerCase();
  const entry = Object.entries(GROUPS).find(
    ([g]) => g.toLowerCase() === groupParam
  );
  if (!entry)
    return res
      .status(404)
      .json({ error: `Unknown group "${req.params.group}"` });

  const targets = entry[1];
  const limit = Math.min(parseInt(req.query.limit || "40", 10), 100);
  const offset = parseInt(req.query.offset || "0", 10);

  try {
    const lists = await Promise.all(targets.map((t) => fetchByTarget(t))); // ✅ already normalized
    const merged = lists.flat();
    const seen = new Set();
    const dedup = merged.filter((ex) => {
      const key = ex.id || ex.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const total = dedup.length;
    const slice = dedup.slice(offset, offset + limit);
    res.json({
      group: entry[0],
      targets,
      total,
      limit,
      offset,
      results: slice,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching group" });
  }
});

// GET /api/exercises/plans/group/:group
router.get("/plans/group/:group", async (req, res) => {
  const groupParam = (req.params.group || "").toLowerCase();
  const entry = Object.entries(GROUPS).find(
    ([g]) => g.toLowerCase() === groupParam
  );
  if (!entry)
    return res
      .status(404)
      .json({ error: `Unknown group "${req.params.group}"` });

  const groupName = entry[0];
  const targets = entry[1];

  try {
    const lists = await Promise.all(targets.map((t) => fetchByTarget(t))); // ✅ already normalized
    const merged = shuffle(lists.flat());

    const day1 = merged.slice(0, 5);
    const day2 = merged.slice(5, 10);
    const day3 = merged.slice(10, 15);

    res.json({
      group: groupName,
      targets,
      days: [
        buildDay("Day 1", day1, groupName),
        buildDay("Day 2", day2, groupName),
        buildDay("Day 3", day3, groupName),
      ],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error building group plan" });
  }
});

module.exports = router;
