const express = require("express");
const slugify = require("slugify");
const jwt = require("jsonwebtoken");
const Post = require("../models/Post.model");
const Comment = require("../models/Comment.model");
const Like = require("../models/Like.model");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/** Helper: try to read userId from Authorization header without forcing auth */
function getOptionalUserId(req) {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload?.sub || null;
  } catch {
    return null;
  }
}

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
        .populate("author", "firstName lastName nickName profileImage")
        .lean(),
      Post.countDocuments(filter),
    ]);

    // Mark likedByMe when user is logged in
    const userId = getOptionalUserId(req);
    if (userId && posts.length) {
      const postIds = posts.map((p) => p._id);
      const liked = await Like.find({ post: { $in: postIds }, user: userId })
        .select("post")
        .lean();
      const likedSet = new Set(liked.map((l) => String(l.post)));
      posts.forEach((p) => {
        p.likedByMe = likedSet.has(String(p._id));
      });
    }

    res.json({ page, limit, total, posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list posts" });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const post = await Post.findOne({ slug: req.params.slug })
      .populate("author", "firstName lastName nickName profileImage")
      .lean();
    if (!post) return res.status(404).json({ error: "Post not found" });

    // Mark likedByMe for single post too
    const userId = getOptionalUserId(req);
    if (userId) {
      const liked = await Like.exists({ post: post._id, user: userId });
      post.likedByMe = !!liked;
    }

    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get post" });
  }
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

// Like toggle — now returns likesCount as well
router.post("/:postId/like", requireAuth, async (req, res) => {
  const { postId } = req.params;
  try {
    // Try to like
    await Like.create({ post: postId, user: req.user.sub });
    const updated = await Post.findByIdAndUpdate(
      postId,
      { $inc: { likesCount: 1 } },
      { new: true }
    ).select("likesCount");
    return res.json({ liked: true, likesCount: updated?.likesCount ?? 0 });
  } catch (e) {
    await Like.findOneAndDelete({ post: postId, user: req.user.sub });
    const updated = await Post.findByIdAndUpdate(
      postId,
      { $inc: { likesCount: -1 } },
      { new: true }
    ).select("likesCount");
    return res.json({ liked: false, likesCount: updated?.likesCount ?? 0 });
  }
});

module.exports = router;
