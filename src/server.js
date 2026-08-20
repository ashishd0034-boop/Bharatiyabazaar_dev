const express = require("express");
const cors = require("cors");
const path = require("path"); // Added for serving static files
require("dotenv").config();

// Route imports
const authRoutes = require("./routes/authRoutes");
const memberRoutes = require("./routes/memberRoutes");
const walletRoutes = require("./routes/walletRoutes");
const withdrawalRoutes = require("./routes/withdrawalRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const adminRoutes = require("./routes/adminRoutes");
const healthRoutes = require("./routes/healthRoutes");
const idCardRoutes = require("./routes/idCardRoutes"); // Legacy from before, keeping it

// Middleware
const errorHandler = require("./middleware/errorMiddleware");
const auth = require("./middleware/authMiddleware");

const app = express();

// Global Middleware
app.use(cors());
app.use(express.json());

// --- NEW: Serve Static Files (Frontend) ---
// This tells Express to look for HTML/CSS/JS files in the 'public' folder
app.use(express.static(path.join(__dirname, "../public")));

// When someone visits the root URL, serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "bb-bharatiya-bazaar-v2.html"));
});
// -----------------------------------------

// API routes
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/withdrawals", withdrawalRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/id-cards", auth, idCardRoutes);

// Global Error Handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 4000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app; // Export for testing