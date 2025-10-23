const express = require("express");
const slugify = require("slugify");
const Post = require("../models/Post.model");
const Comment = require("../models/Comment.model");
const Like = require("../models/Like.model");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(parseInt(req.query.limit || "10"), 50);
    const q = (req.query.q || "").trim();

    const filter = { published: true };
    if (q) {
      filter.$or = [
        { title: new RegExp(q, "i") },
        { tags: new RegExp(`^${q}$`, "i") },
      ];
    }

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("author", "firstName lastName nickName profileImage"),
      Post.countDocuments(filter),
    ]);

    res.json({ page, limit, total, posts });
  } catch (err) {
    res.status(500).json({ error: "Failed to list posts" });
  }
});

router.get("/:slug", async (req, res) => {
  const post = await Post.findOne({ slug: req.params.slug }).populate(
    "author",
    "firstName lastName nickName profileImage"
  );
  if (!post) return res.status(404).json({ error: "Post not found" });
  res.json(post);
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { title, body, tags = [], images = [], published = true } = req.body;
    if (!title || !body)
      return res.status(400).json({ error: "Title and body are required" });

    const slugBase = slugify(title, { lower: true, strict: true }) || "post";
    const slug = `${slugBase}-${Date.now()}`;

    const post = await Post.create({
      author: req.user.sub,
      title,
      body,
      tags,
      images,
      slug,
      published,
    });

    const populated = await Post.findById(post._id).populate(
      "author",
      "firstName lastName nickName profileImage"
    );

    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to create post" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const p = await Post.findById(req.params.id);
    if (!p) return res.status(404).json({ error: "Post not found" });

    if (p.author.toString() !== req.user.sub && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updatable = ["title", "body", "tags", "images", "published"];
    updatable.forEach((k) => {
      if (req.body[k] !== undefined) p[k] = req.body[k];
    });

    if (req.body.title) {
      const base =
        slugify(req.body.title, { lower: true, strict: true }) || "post";
      p.slug = `${base}-${p._id.toString().slice(-6)}`;
    }

    await p.save();
    const populated = await Post.findById(p._id).populate(
      "author",
      "firstName lastName nickName profileImage"
    );
    res.json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update post" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const p = await Post.findById(req.params.id);
    if (!p) return res.status(404).json({ error: "Post not found" });
    if (p.author.toString() !== req.user.sub && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    await Promise.all([
      Comment.deleteMany({ post: p._id }),
      Like.deleteMany({ post: p._id }),
      p.deleteOne(),
    ]);

    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

router.post("/:postId/like", requireAuth, async (req, res) => {
  const { postId } = req.params;
  try {
    await Like.create({ post: postId, user: req.user.sub });
    await Post.findByIdAndUpdate(postId, { $inc: { likesCount: 1 } });
    return res.json({ liked: true });
  } catch (e) {
    await Like.findOneAndDelete({ post: postId, user: req.user.sub });
    await Post.findByIdAndUpdate(postId, { $inc: { likesCount: -1 } });
    return res.json({ liked: false });
  }
});

module.exports = router;
