const mongoose = require("mongoose");

const { MONGODB_URI = "mongodb://127.0.0.1:27017/Fitness-World" } = process.env;

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {});
    console.log(`✅ MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
