const express = require("express");
const Comment = require("../models/Comment.model");
const Post = require("../models/Post.model");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/:postId", async (req, res) => {
  const { postId } = req.params;
  const comments = await Comment.find({ post: postId })
    .sort({ createdAt: 1 })
    .populate("author", "firstName lastName nickName profileImage");
  res.json(comments);
});

router.post("/:postId", requireAuth, async (req, res) => {
  const { postId } = req.params;
  const { body } = req.body;
  if (!body || !body.trim())
    return res.status(400).json({ error: "Comment body is required" });

  const comment = await Comment.create({
    post: postId,
    author: req.user.sub,
    body: body.trim(),
  });

  await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

  const populated = await Comment.findById(comment._id).populate(
    "author",
    "firstName lastName nickName profileImage"
  );

  res.status(201).json(populated);
});

router.delete("/:commentId", requireAuth, async (req, res) => {
  const c = await Comment.findById(req.params.commentId);
  if (!c) return res.status(404).json({ error: "Comment not found" });

  if (c.author.toString() !== req.user.sub && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  await Promise.all([
    Comment.deleteOne({ _id: c._id }),
    Post.findByIdAndUpdate(c.post, { $inc: { commentsCount: -1 } }),
  ]);

  res.status(204).end();
});

module.exports = router;
