const { Schema, model, Types } = require("mongoose");

const likeSchema = new Schema(
  {
    post: { type: Types.ObjectId, ref: "Post", index: true, required: true },
    user: { type: Types.ObjectId, ref: "User", index: true, required: true },
  },
  { timestamps: true }
);

likeSchema.index({ post: 1, user: 1 }, { unique: true });

module.exports = model("Like", likeSchema);
