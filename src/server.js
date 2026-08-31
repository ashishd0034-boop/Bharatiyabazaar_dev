const express = require("express");
const cors = require("cors");
const path = require("path"); // Added for serving static files
const helmet = require("helmet");
const { createRateLimiter } = require("./core/utils/rateLimiter");
require("dotenv").config();

// Fail-fast JWT Check
if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET is not defined.");
  process.exit(1);
}

// Route imports
const authRoutes = require("./modules/auth/auth.routes");
const memberRoutes = require("./modules/member/member.routes");
const walletRoutes = require("./modules/wallet/wallet.routes");
const withdrawalRoutes = require("./modules/withdrawal/withdrawal.routes");
const vendorRoutes = require("./routes/vendorRoutes");
const adminRoutes = require("./routes/adminRoutes");
const setuKoshRoutes = require("./routes/setuKoshRoutes");
const healthRoutes = require("./routes/healthRoutes");
const idCardRoutes = require("./routes/idCardRoutes"); // Legacy from before, keeping it
const pinRoutes = require("./modules/pin/pin.routes");

// Middleware
const errorHandler = require("./core/middleware/error.middleware");
const auth = require("./core/middleware/auth.middleware");

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

const globalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  prodMax: 300 // 300 requests in prod, 30,000 in dev/test
});
app.use(globalLimiter);

// --- Tiered Static Assets & Anti-Stale Caching ---
app.use(express.static(path.join(__dirname, "../public"), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") {
      // HTML documents: NEVER cache in browser memory/disk, force immediate fresh fetch
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.removeHeader("ETag");
    } else if (ext === ".js" || ext === ".css") {
      // Scripts and stylesheets: Revalidate with ETag on every request
      res.setHeader("Cache-Control", "no-cache, must-revalidate, max-age=0");
    } else if ([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".woff", ".woff2", ".ttf", ".ico"].includes(ext)) {
      // Static media: Cache for 24h
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));

// When someone visits the root URL, serve the main canonical landing page (uncached)
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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