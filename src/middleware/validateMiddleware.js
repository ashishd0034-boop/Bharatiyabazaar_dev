// Backwards-compatibility shim: Re-exports validate middleware from src/core/middleware/validate.middleware.js
const validate = require("../core/middleware/validate.middleware");

module.exports = validate;
