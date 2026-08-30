const { z } = require("zod");

const autopoolExplorerQuerySchema = z.object({
  query: z.object({
    root: z.string().optional(),
    depth: z.string().regex(/^[1-7]$/, "Depth must be between 1 and 7").optional()
  }).optional()
});

module.exports = {
  autopoolExplorerQuerySchema
};
