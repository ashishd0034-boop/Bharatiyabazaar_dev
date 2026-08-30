// Backwards-compatibility shim: Re-exports Prisma client from src/core/database/prisma.js
const prisma = require("../core/database/prisma");

module.exports = prisma;