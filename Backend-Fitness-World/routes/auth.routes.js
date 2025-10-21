const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ error: "Invalid email or password" });

    const ok = await user.comparePassword(password);
    if (!ok)
      return res.status(401).json({ error: "Invalid email or password" });

    const payload = { sub: user._id, email: user.email };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    const { _id, birthday, gender, countryCode, createdAt } = user;
    res.json({
      token,
      user: { _id, email, birthday, gender, countryCode, createdAt },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
