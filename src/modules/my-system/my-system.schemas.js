const { z } = require("zod");

// MY SYSTEM validation schemas
const mySystemTreeQuerySchema = z.object({
  query: z.object({
    depth: z.string().regex(/^\d+$/).optional()
  }).optional()
});

module.exports = {
  mySystemTreeQuerySchema
};
