const express = require("express");
const User = require("../models/User.model");
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const {
      profileImage,
      email,
      password,
      birthday,
      gender,
      firstName,
      lastName,
      nickName,
      countryCode,
    } = req.body;

    const user = await User.create({
      profileImage,
      email,
      password,
      birthday,
      gender,
      firstName,
      lastName,
      nickName,
      countryCode,
    });

    const { _id, createdAt } = user;
    res.status(201).json({
      _id,
      email,
      birthday,
      gender,
      firstName,
      lastName,
      nickName,
      countryCode,
      profileImage: user.profileImage,
      createdAt,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Email already exists" });
    }
    res.status(400).json({ error: err.message });
  }
});

router.get("/", async (_req, res) => {
  const users = await User.find().select("-password").lean();
  res.json(users);
});

module.exports = router;
