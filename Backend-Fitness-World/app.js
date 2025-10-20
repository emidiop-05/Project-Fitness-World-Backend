import dotenv from "dotenv";
import express from "express";

const app = express();

require("./config")(app);

const indexRoutes = require("./routes/index.routes");
app.use("/api", indexRoutes);

require("./error-handling")(app);

module.exports = app;
