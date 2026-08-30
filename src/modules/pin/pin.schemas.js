const { z } = require("zod");

const purchasePinSchema = z.object({
  body: z.object({
    quantity: z.number().int().min(1, "Quantity must be between 1 and 10").max(10, "Quantity must be between 1 and 10")
  })
});

const validatePinSchema = z.object({
  body: z.object({
    pinCode: z.string().min(1, "PIN code is required")
  })
});

module.exports = {
  purchasePinSchema,
  validatePinSchema
};
