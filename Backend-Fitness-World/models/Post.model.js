const { Schema, model, Types } = require("mongoose");

const postSchema = new Schema(
  {
    author: { type: Types.ObjectId, ref: "User", index: true, required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    body: { type: String, required: true },
    tags: [{ type: String, index: true }],
    images: [String],
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);

postSchema.index({ createdAt: -1 });

module.exports = model("Post", postSchema);
