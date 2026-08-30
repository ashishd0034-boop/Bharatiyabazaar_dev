const { z } = require("zod");

const walletLedgerQuerySchema = z.object({
  query: z.object({
    limit: z.string().regex(/^\d+$/).optional(),
    offset: z.string().regex(/^\d+$/).optional()
  }).optional()
});

module.exports = {
  walletLedgerQuerySchema
};
