const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "avatars");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const userId = req.user?.sub || "anon";
    cb(null, `avatar_${userId}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(ok ? null : new Error("Only images allowed"), ok);
  },
});

function auth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function getBaseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.BACKEND_BASE_URL) return process.env.BACKEND_BASE_URL;

  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString()
    .split(",")[0]
    .trim();
  const host = req.get("host");
  return `${proto}://${host}`;
}

router.post("/avatar", auth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const publicUrl = `${getBaseUrl(req)}/uploads/avatars/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(
      req.user.sub,
      { profileImage: publicUrl },
      { new: true, select: "-password" }
    ).lean();

    return res.json({ url: publicUrl, user });
  } catch (err) {
    if (err && /Only images allowed/i.test(err.message)) {
      return res.status(400).json({ error: "Only images allowed" });
    }
    console.error("Avatar upload error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
