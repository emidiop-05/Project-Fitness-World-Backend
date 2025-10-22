const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

router.get("/me", auth, async (req, res) => {
  try {
    if (!req.user?.sub)
      return res.status(400).json({ error: "Malformed token (no sub)" });

    const user = await User.findById(req.user.sub).select("-password").lean();

    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({ user });
  } catch (err) {
    console.error("GET /api/protected/me error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
