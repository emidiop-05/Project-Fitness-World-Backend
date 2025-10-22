require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./db");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5005;

const FRONTENDS = [
  "http://localhost:5173",
  process.env.FRONTEND_URL, // e.g., https://your-frontend.netlify.app
].filter(Boolean);

app.use(express.json());

app.use(
  cors({
    origin: FRONTENDS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());

app.use(morgan("dev"));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/protected", require("./routes/protected.routes"));
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/users", require("./routes/users.routes"));
app.use("/api/uploads", require("./routes/uploads.routes"));
app.use("/api/exercises", require("./routes/exercises.routes"));

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
