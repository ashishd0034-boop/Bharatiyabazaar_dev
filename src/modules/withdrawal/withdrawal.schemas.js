const { z } = require("zod");

const withdrawalRequestSchema = z.object({
  body: z.object({
    idCardId: z.string().optional(),
    method: z.enum(["BANK", "UPI", "WALLET", "MEMBER_WALLET", "VOUCHER_CONVERSION"]).optional(),
    amountPaise: z.number().positive("Amount must be positive"),
    paymentDetails: z.any().optional(),
    idempotencyKey: z.string().optional()
  })
});

const withdrawalActionSchema = z.object({
  body: z.object({
    withdrawalId: z.string().optional(),
    reason: z.string().optional()
  }).optional()
});

module.exports = {
  withdrawalRequestSchema,
  withdrawalActionSchema
};
