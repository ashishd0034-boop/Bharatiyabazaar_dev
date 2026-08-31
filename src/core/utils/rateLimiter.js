const rateLimit = require("express-rate-limit");

/**
 * Environment-aware rate limiter factory.
 * 
 * - In PRODUCTION: Enforces strict security thresholds (`prodMax`).
 * - In DEVELOPMENT / TEST: Scales threshold by `devMultiplier` (default: 100x) or `devMax`
 *   to allow smooth automated testing and manual QA cycles.
 * - Retains exact HTTP 429 response structure:
 *   `{ success: false, error: { code: "TOO_MANY_REQUESTS", message: "<custom message>" } }`
 * - Retains standardHeaders: true (RateLimit-* headers) and legacyHeaders: false.
 *
 * @param {Object} options
 * @param {number} [options.windowMs=900000] - Time window in milliseconds (default: 15 mins)
 * @param {number} options.prodMax - Maximum requests allowed in production per window
 * @param {number} [options.devMax=null] - Explicit override for development/test max
 * @param {number} [options.devMultiplier=100] - Multiplier applied to prodMax in dev/test
 * @param {string|Object} [options.message] - Error message string or custom response object
 * @param {string} [options.code="TOO_MANY_REQUESTS"] - Error code identifier
 * @param {boolean} [options.standardHeaders=true] - Draft-6/draft-7 RateLimit-* headers
 * @param {boolean} [options.legacyHeaders=false] - X-RateLimit-* headers
 * @returns {import("express").RequestHandler} Express rate limit middleware
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    prodMax,
    devMax = null,
    devMultiplier = 100,
    message,
    code = "TOO_MANY_REQUESTS",
    standardHeaders = true,
    legacyHeaders = false,
    ...rest
  } = options;

  if (prodMax === undefined || prodMax === null) {
    throw new Error("createRateLimiter requires a 'prodMax' option.");
  }

  const isProduction = process.env.NODE_ENV === "production";
  const effectiveMax = isProduction
    ? prodMax
    : (devMax ?? prodMax * devMultiplier);

  const rateLimitConfig = {
    windowMs,
    max: effectiveMax,
    standardHeaders,
    legacyHeaders,
    ...rest
  };

  if (message !== undefined) {
    rateLimitConfig.message = typeof message === "string"
      ? { success: false, error: { code, message } }
      : message;
  }

  return rateLimit(rateLimitConfig);
}

module.exports = {
  createRateLimiter
};
