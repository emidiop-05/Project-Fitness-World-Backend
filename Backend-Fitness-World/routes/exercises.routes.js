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

function withGif(ex) {
  const id = ex?.id || ex?._id || ex?.uuid || ex?.name || "";
  const fallback = id
    ? `https://v2.exercisedb.io/image/${encodeURIComponent(id)}.gif`
    : null;
  return { ...ex, gifUrl: ex.gifUrl || ex.image || ex.imageUrl || fallback };
}

const GROUPS = {
  Chest: ["pectorals", "serratus anterior"],
  Back: ["lats", "upper back", "traps", "spine", "levator scapulae"],
  Shoulders: ["delts"],
  Arms: ["biceps", "triceps", "forearms"],
  Core: ["abs"],
  Legs: ["quads", "hamstrings", "glutes", "calves", "abductors", "adductors"],
  Cardio: ["cardiovascular system"],
};

const AREAS = {
  UpperBody: ["Chest", "Back", "Shoulders", "Arms"],
  LowerBody: ["Core", "Legs"],
  FullBody: ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs", "Cardio"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetries(url, opts, retries = 3, backoffMs = 400) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && i < retries) {
          await sleep(backoffMs * (i + 1));
          continue;
        }
        throw new Error(`[${res.status}] ${text || "error"}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        return text ? JSON.parse(text) : null;
      }
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await sleep(backoffMs * (i + 1));
        continue;
      }
    }
  }
  throw lastErr || new Error("request failed");
}

async function fetchByTarget(target) {
  const url = `${BASE}/exercises/target/${encodeURIComponent(target)}`;
  const data = await fetchJsonWithRetries(url, { headers: headers() }, 3, 500);
  const list = Array.isArray(data) ? data : [];
  return list.map(withGif);
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function buildDay(name, list, muscleLabel) {
  return {
    name,
    blocks: (list || []).map((ex) => ({
      id: ex.id || ex.name,
      name: ex.name,
      equipment: ex.equipment || "body weight",
      target: ex.target || muscleLabel,
      gifUrl: ex.gifUrl || ex.image || ex.imageUrl || null,
      sets: 3,
      reps: 8,
      restSec: 90,
    })),
  };
}

async function safeFetchByTarget(target) {
  try {
    return await fetchByTarget(target);
  } catch (e) {
    console.warn("[exercises] target failed:", target, String(e).slice(0, 160));
    return [];
  }
}

async function fetchTargetsWithLimit(targets, concurrency = 2, delayMs = 300) {
  const out = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((t) => safeFetchByTarget(t)));
    out.push(...results.flat());
    if (i + concurrency < targets.length) await sleep(delayMs);
  }
  return out;
}

function dedupByIdOrName(list) {
  const seen = new Set();
  return (list || []).filter((ex) => {
    const key = ex.id || ex.name;
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitIntoThreeDays(list, label) {
  const total = list.length;
  if (total === 0)
    return [
      buildDay("Day 1", [], label),
      buildDay("Day 2", [], label),
      buildDay("Day 3", [], label),
    ];
  const perDay = Math.max(4, Math.min(6, Math.floor(total / 3) || 4));
  const day1 = list.slice(0, perDay);
  const day2 = list.slice(perDay, perDay * 2);
  const day3 = list.slice(perDay * 2, perDay * 3);
  return [
    buildDay("Day 1", day1, label),
    buildDay("Day 2", day2, label),
    buildDay("Day 3", day3, label),
  ];
}

router.get("/targets", async (_req, res) => {
  try {
    const data = await fetchJsonWithRetries(
      `${BASE}/exercises/targetList`,
      { headers: headers() },
      2,
      400
    );
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching targets" });
  }
});

router.get("/exercise/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await fetchJsonWithRetries(
      `${BASE}/exercises/exercise/${encodeURIComponent(id)}`,
      { headers: headers() },
      2,
      400
    );
    const exercise = Array.isArray(data) ? data[0] : data;
    if (!exercise) return res.status(404).json({ error: "Exercise not found" });
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
    const allRaw = await fetchJsonWithRetries(
      `${BASE}/exercises/target/${encodeURIComponent(muscle)}`,
      { headers: headers() },
      2,
      400
    );
    const all = (Array.isArray(allRaw) ? allRaw : []).map(withGif);
    const slice = all.slice(offset, offset + limit);
    res.json({ total: all.length, limit, offset, results: slice });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching exercises" });
  }
});

router.get("/plans/:muscle", async (req, res) => {
  const { muscle } = req.params;
  try {
    const raw = await fetchJsonWithRetries(
      `${BASE}/exercises/target/${encodeURIComponent(muscle)}`,
      { headers: headers() },
      2,
      400
    );
    const exercises = (Array.isArray(raw) ? raw : []).map(withGif);
    const shuffled = shuffle(exercises);
    const [d1, d2, d3] = splitIntoThreeDays(shuffled, muscle);
    res.json({ muscle, days: [d1, d2, d3] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error creating plan" });
  }
});

router.get("/groups", (_req, res) => {
  res.json(
    Object.entries(GROUPS).map(([group, targets]) => ({ group, targets }))
  );
});

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
    const lists = await Promise.all(targets.map((t) => safeFetchByTarget(t)));
    const merged = dedupByIdOrName(lists.flat());
    const slice = merged.slice(offset, offset + limit);
    res.json({
      group: entry[0],
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
    const lists = await Promise.all(targets.map((t) => safeFetchByTarget(t)));
    const merged = shuffle(dedupByIdOrName(lists.flat()));
    const [d1, d2, d3] = splitIntoThreeDays(merged, groupName);
    res.json({ group: groupName, targets, days: [d1, d2, d3] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error building group plan" });
  }
});

router.get("/areas", (_req, res) => {
  res.json(Object.entries(AREAS).map(([area, groups]) => ({ area, groups })));
});

router.get("/area/:area", async (req, res) => {
  const areaParam = (req.params.area || "").toLowerCase();
  const entry = Object.entries(AREAS).find(
    ([a]) => a.toLowerCase() === areaParam
  );
  if (!entry)
    return res.status(404).json({ error: `Unknown area "${req.params.area}"` });

  const areaName = entry[0];
  const groups = entry[1];
  const allTargets = groups.flatMap((g) => GROUPS[g] || []);
  const limit = Math.min(parseInt(req.query.limit || "60", 10), 120);
  const offset = parseInt(req.query.offset || "0", 10);

  try {
    const merged = await fetchTargetsWithLimit(allTargets, 2, 300);
    const dedup = dedupByIdOrName(merged);
    const slice = dedup.slice(offset, offset + limit);
    res.json({
      area: areaName,
      groups,
      total: dedup.length,
      limit,
      offset,
      results: slice,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error fetching area" });
  }
});

router.get("/plans/area/:area", async (req, res) => {
  const areaParam = (req.params.area || "").toLowerCase();
  const entry = Object.entries(AREAS).find(
    ([a]) => a.toLowerCase() === areaParam
  );
  if (!entry)
    return res.status(404).json({ error: `Unknown area "${req.params.area}"` });

  const areaName = entry[0];
  const groups = entry[1];
  const allTargets = groups.flatMap((g) => GROUPS[g] || []);

  try {
    const merged = shuffle(await fetchTargetsWithLimit(allTargets, 2, 300));
    const dedup = dedupByIdOrName(merged);

    if (dedup.length === 0) {
      return res.status(502).json({
        error: "No exercises available for this area right now",
        area: areaName,
      });
    }

    const [d1, d2, d3] = splitIntoThreeDays(dedup, areaName);
    res.json({ area: areaName, groups, days: [d1, d2, d3] });
  } catch (e) {
    console.error("[exercises] area plan error:", e);
    res.status(500).json({ error: "Server error building area plan" });
  }
});

module.exports = router;
