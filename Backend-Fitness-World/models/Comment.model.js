const { Schema, model, Types } = require("mongoose");

const commentSchema = new Schema(
  {
    post: { type: Types.ObjectId, ref: "Post", index: true, required: true },
    author: { type: Types.ObjectId, ref: "User", index: true, required: true },
    body: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

commentSchema.index({ createdAt: 1 });

module.exports = model("Comment", commentSchema);
