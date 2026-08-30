// Backwards-compatibility shim: Re-exports optionalAuthMiddleware from src/core/middleware/optional-auth.middleware.js
const optionalAuthMiddleware = require("../core/middleware/optional-auth.middleware");

module.exports = optionalAuthMiddleware;
