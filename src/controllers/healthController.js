const prisma = require("../lib/prisma");

async function checkHealth(req, res) {
  res.json({
    status: "ok",
    app: "Bharatiya Bazaar API",
    timestamp: new Date().toISOString()
  });
}

async function checkDbHealth(req, res, next) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      database: "disconnected",
      error: error.message
    });
  }
}

module.exports = {
  checkHealth,
  checkDbHealth
};
