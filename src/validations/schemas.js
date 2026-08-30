const { z } = require("zod");
const { registerSchema, loginSchema, adminLoginSchema, verifyPinSchema } = require("../modules/auth/auth.schemas");
const { kycSchema } = require("../modules/member/member.schemas");
const { purchasePinSchema, validatePinSchema } = require("../modules/pin/pin.schemas");
const { withdrawalRequestSchema } = require("../modules/withdrawal/withdrawal.schemas");

const vendorSaleSchema = z.object({
  body: z.object({
    memberId: z.string().optional(),
    buyerCode: z.string().optional(),
    cardNumber: z.string().optional(),
    memberCode: z.string().optional(),
    idCardId: z.string().optional(),
    amountPaise: z.number().positive("Amount must be positive"),
    idempotencyKey: z.string().optional()
  })
});

const vendorRegisterSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Owner name is required"),
    businessName: z.string().min(2, "Business name is required"),
    mobile: z.string().length(10, "Mobile must be 10 digits").regex(/^\d+$/),
    password: z.string().min(6, "Password must be at least 6 characters"),
    category: z.string().optional().default("GENERAL"),
    entityType: z.enum(["INDIVIDUAL", "COMPANY"]).optional().default("INDIVIDUAL"),
    panNumber: z.string().min(10, "PAN must be 10 characters").optional(),
    gstin: z.string().optional(),
    address: z.string().optional(),
    pinCode: z.string().optional(),
    payoutMethod: z.enum(["WALLET", "BANK"]).optional().default("BANK"),
    referrerCode: z.string().optional(),
    referrerMemberCode: z.string().optional()
  })
});

const settingUpdateSchema = z.object({
  body: z.object({
    value: z.string().min(1, "Value is required"),
    description: z.string().optional()
  })
});

const adminGeneratePinSchema = z.object({
  body: z.object({
    count: z.number().int().min(1, "Count must be at least 1").max(20, "Count cannot exceed 20").optional().default(1),
    quantity: z.number().int().min(1, "Quantity must be at least 1").max(10, "Quantity cannot exceed 10").optional().default(1),
    reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(255, "Reason cannot exceed 255 characters")
  })
});

module.exports = {
  registerSchema,
  loginSchema,
  adminLoginSchema,
  kycSchema,
  withdrawalRequestSchema,
  vendorSaleSchema,
  vendorRegisterSchema,
  settingUpdateSchema,
  adminGeneratePinSchema,
  verifyPinSchema,
  purchasePinSchema,
  validatePinSchema
};
