require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./db");

const app = express();
const PORT = process.env.PORT || 5005;

app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"], // add your prod URL later
    credentials: true,
  })
);
app.use("/api/auth", require("./routes/auth.routes"));
connectDB();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/users", require("./routes/users.routes"));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
