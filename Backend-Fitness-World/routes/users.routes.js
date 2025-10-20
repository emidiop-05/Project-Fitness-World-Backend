const express = require("express");
const User = require("../models/User.model");
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.create({ email, password });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Email already exists" });
    }
    res.status(400).json({ error: err.message });
  }
});

router.get("/", async (_req, res) => {
  const users = await User.find().lean();
  res.json(users);
});

module.exports = router;
