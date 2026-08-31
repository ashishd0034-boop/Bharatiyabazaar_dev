const express = require("express");
const request = require("supertest");
const { createRateLimiter } = require("../../src/core/utils/rateLimiter");
const compatRateLimiter = require("../../src/utils/rateLimiter");

describe("Unit: Environment-Aware Rate Limiter Factory", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("should provide backward compatibility via src/utils/rateLimiter", () => {
    expect(compatRateLimiter.createRateLimiter).toBe(createRateLimiter);
  });

  it("should throw an error if prodMax is missing", () => {
    expect(() => createRateLimiter({})).toThrow("createRateLimiter requires a 'prodMax' option.");
  });

  describe("Production Mode (NODE_ENV=production)", () => {
    let app;

    beforeEach(() => {
      process.env.NODE_ENV = "production";
      app = express();
      app.use(express.json());

      const strictLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        prodMax: 3,
        message: "Custom strict rate limit exceeded message."
      });

      app.get("/test-prod-endpoint", strictLimiter, (req, res) => {
        res.status(200).json({ success: true, data: "ok" });
      });
    });

    it("should strictly enforce prodMax in production and return 429 on breach", async () => {
      // 3 successful requests
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/test-prod-endpoint");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["ratelimit-limit"]).toBe("3");
      }

      // 4th request must breach limit
      const blockedRes = await request(app).get("/test-prod-endpoint");
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toEqual({
        success: false,
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Custom strict rate limit exceeded message."
        }
      });
      expect(blockedRes.headers).toHaveProperty("ratelimit-limit");
      expect(blockedRes.headers).toHaveProperty("ratelimit-remaining");
      expect(blockedRes.headers).toHaveProperty("ratelimit-reset");
    });
  });

  describe("Development Mode (NODE_ENV=development)", () => {
    let app;

    beforeEach(() => {
      process.env.NODE_ENV = "development";
      app = express();
      app.use(express.json());

      const devLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        prodMax: 5,
        message: "Too many attempts, please try again later."
      });

      app.get("/test-dev-endpoint", devLimiter, (req, res) => {
        res.status(200).json({ success: true, data: "ok" });
      });
    });

    it("should scale threshold by 100x (5 -> 500) and allow 50+ rapid consecutive requests with ZERO 429s", async () => {
      const TOTAL_REQUESTS = 60;
      const responses = [];

      for (let i = 0; i < TOTAL_REQUESTS; i++) {
        responses.push(await request(app).get("/test-dev-endpoint"));
      }

      // Check every response: none should be 429
      const fourTwentyNines = responses.filter((r) => r.status === 429);
      expect(fourTwentyNines.length).toBe(0);

      // Verify all were successful 200
      expect(responses.every((r) => r.status === 200)).toBe(true);

      // Check standard headers reflect 500 max limit
      expect(responses[0].headers["ratelimit-limit"]).toBe("500");
      expect(parseInt(responses[TOTAL_REQUESTS - 1].headers["ratelimit-remaining"], 10)).toBe(500 - TOTAL_REQUESTS);
    });
  });

  describe("Test Mode (NODE_ENV=test)", () => {
    let app;

    beforeEach(() => {
      process.env.NODE_ENV = "test";
      app = express();
      app.use(express.json());

      const testLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        prodMax: 10,
        message: "Too many PIN verification attempts, please try again later."
      });

      app.get("/test-test-endpoint", testLimiter, (req, res) => {
        res.status(200).json({ success: true });
      });
    });

    it("should scale threshold by 100x (10 -> 1000) in test mode", async () => {
      const res = await request(app).get("/test-test-endpoint");
      expect(res.status).toBe(200);
      expect(res.headers["ratelimit-limit"]).toBe("1000");
    });
  });

  describe("Custom devMax override", () => {
    it("should respect explicit devMax if supplied", async () => {
      process.env.NODE_ENV = "development";
      const app = express();
      const customLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        prodMax: 5,
        devMax: 777
      });
      app.get("/test-custom-dev", customLimiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const res = await request(app).get("/test-custom-dev");
      expect(res.headers["ratelimit-limit"]).toBe("777");
    });
  });
});
