// Backwards-compatibility shim: Re-exports adminAuthMiddleware from src/core/middleware/admin-auth.middleware.js
const requireAdmin = require("../core/middleware/admin-auth.middleware");

module.exports = requireAdmin;
