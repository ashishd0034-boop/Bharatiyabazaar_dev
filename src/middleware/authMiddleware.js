// Backwards-compatibility shim: Re-exports authMiddleware from src/core/middleware/auth.middleware.js
const authMiddleware = require("../core/middleware/auth.middleware");

module.exports = authMiddleware;
