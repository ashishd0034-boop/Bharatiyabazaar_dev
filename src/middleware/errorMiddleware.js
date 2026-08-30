// Backwards-compatibility shim: Re-exports errorHandler from src/core/middleware/error.middleware.js
const errorHandler = require("../core/middleware/error.middleware");

module.exports = errorHandler;