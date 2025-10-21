const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
  res.json({
    ok: true,
    user: { id: req.user.sub, email: req.user.email },
  });
});

module.exports = router;
