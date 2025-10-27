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

const allowlist = ["http://localhost:5173", process.env.FRONTEND_URL].filter(
  Boolean
);

const netlifyRegex = /^https:\/\/([a-z0-9-]+)\.netlify\.app$/i;

const corsOptions = {
  origin(origin, cb) {
    +(+console.log("CORS origin:", origin));
    if (!origin) return cb(null, true);

    const allowed = allowlist.includes(origin) || netlifyRegex.test(origin);

    if (allowed) return cb(null, true);
    console.warn("❌ Blocked by CORS:", origin);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(morgan("dev"));
+(+app.use(express.json()));

const UPLOADS_ROOT = path.join(__dirname, "uploads");
const AVATARS_DIR = path.join(UPLOADS_ROOT, "avatars");
fs.mkdirSync(AVATARS_DIR, { recursive: true });

app.use("/uploads", express.static(UPLOADS_ROOT, {}));

app.use("/api/protected", require("./routes/protected.routes"));
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/users", require("./routes/users.routes"));
app.use("/api/uploads", require("./routes/uploads.routes"));
app.use("/api/exercises", require("./routes/exercises.routes"));
app.use("/api/posts", require("./routes/posts.routes"));
app.use("/api/comments", require("./routes/comments.routes"));
app.use("/api/ai", require("./routes/ai.routes"));

connectDB();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
