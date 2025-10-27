require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./db");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5005;

app.set("trust proxy", 1);

// ✅ Include both localhost and Render frontend URL
const allowlist = new Set(
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    process.env.FRONTEND_URL, // e.g. https://fitnesss-world.netlify.app
  ].filter(Boolean)
);

// ✅ Allow Netlify preview URLs too
const netlifyRegex = /^https:\/\/([a-z0-9-]+)\.netlify\.app$/i;

// ✅ CORS setup
const corsOptions = {
  origin(origin, cb) {
    console.log("🌍 CORS request from:", origin);
    if (!origin) return cb(null, true); // Allow non-browser or same-origin
    const allowed =
      allowlist.has(origin) ||
      netlifyRegex.test(origin) ||
      origin.includes("onrender.com");

    if (allowed) {
      return cb(null, true);
    } else {
      console.warn("❌ Blocked by CORS:", origin);
      return cb(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ✅ Apply before all routes
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(morgan("dev"));
app.use(express.json()); // ✅ fixed from weird "+(+...)" version

// ✅ Ensure upload directories exist
const UPLOADS_ROOT = path.join(__dirname, "uploads");
const AVATARS_DIR = path.join(UPLOADS_ROOT, "avatars");
fs.mkdirSync(AVATARS_DIR, { recursive: true });

app.use("/uploads", express.static(UPLOADS_ROOT));

// ✅ Routes
app.use("/api/protected", require("./routes/protected.routes"));
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/users", require("./routes/users.routes"));
app.use("/api/uploads", require("./routes/uploads.routes"));
app.use("/api/exercises", require("./routes/exercises.routes"));
app.use("/api/posts", require("./routes/posts.routes"));
app.use("/api/comments", require("./routes/comments.routes"));
app.use("/api/ai", require("./routes/ai.routes"));

// ✅ Connect database
connectDB();

// ✅ Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ✅ Not found handler
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ✅ Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message || err);
  res
    .status(err.status || 500)
    .json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
