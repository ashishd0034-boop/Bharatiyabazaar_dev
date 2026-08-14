const express = require("express");
const cors = require("cors");
require("dotenv").config();

const prisma = require("./lib/prisma");
const memberRoutes = require("./routes/memberRoutes");
const idCardRoutes = require("./routes/idCardRoutes"); // <--- ADDED THIS LINE

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check route
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      app: "Bharatiya Bazaar Backend",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      app: "Bharatiya Bazaar Backend",
      database: "failed",
      error: error.message
    });
  }
});

// API routes
app.use("/api/members", memberRoutes);
app.use("/api/id-cards", idCardRoutes); // <--- ADDED THIS LINE

// Start server
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});