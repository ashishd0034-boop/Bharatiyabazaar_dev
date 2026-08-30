// Backwards-compatibility shim: Re-exports vendorAuthMiddleware from src/core/middleware/vendor-auth.middleware.js
const vendorAuthMiddleware = require("../core/middleware/vendor-auth.middleware");

module.exports = vendorAuthMiddleware;
