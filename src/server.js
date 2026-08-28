const express = require("express");
const cors = require("cors");
const path = require("path"); // Added for serving static files
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// Fail-fast JWT Check
if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET is not defined.");
  process.exit(1);
}

// Route imports
const authRoutes = require("./routes/authRoutes");
const memberRoutes = require("./routes/memberRoutes");
const walletRoutes = require("./routes/walletRoutes");
const withdrawalRoutes = require("./routes/withdrawalRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const adminRoutes = require("./routes/adminRoutes");
const setuKoshRoutes = require("./routes/setuKoshRoutes");
const healthRoutes = require("./routes/healthRoutes");
const idCardRoutes = require("./routes/idCardRoutes"); // Legacy from before, keeping it
const pinRoutes = require("./routes/pinRoutes");

// Middleware
const errorHandler = require("./middleware/errorMiddleware");
const auth = require("./middleware/authMiddleware");

const app = express();

// Global Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"],
      "script-src-attr": ["'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"]
    }
  }
}));

const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : ["http://localhost:4000"];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "100kb" }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// --- NEW: Serve Static Files (Frontend) ---
// This tells Express to look for HTML/CSS/JS files in the 'public' folder
app.use(express.static(path.join(__dirname, "../public")));

// When someone visits the root URL, serve the main canonical landing page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "bharatiya-bazaar-v2.html"));
});
// -----------------------------------------

// API routes
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/withdrawals", withdrawalRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/setu-kosh", setuKoshRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pins", pinRoutes);
app.use("/api/id-cards", auth, idCardRoutes);

// Background Jobs & Startup Seeds
require("./jobs/scheduler");
const { seedSettingsAndSuperAdmin } = require("./lib/seedSettings");
seedSettingsAndSuperAdmin().catch(err => console.error("Error during settings seed:", err));

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