const { z } = require("zod");

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name is required"),
    mobile: z.string().length(10, "Mobile must be 10 digits").regex(/^\d+$/),
    email: z.string().email("Invalid email format").optional(),
    address: z.string().optional(),
    pinCode: z.string().optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    referralCode: z.string().optional(), // NEW
    side: z.enum(["LEFT", "RIGHT"]).optional() // NEW
  })
});

const loginSchema = z.object({
  body: z.object({
    mobile: z.string().min(3, "Enter Member ID or Mobile"),
    password: z.string().min(1, "Password is required")
  })
});

const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required")
  })
});

const kycSchema = z.object({
  body: z.object({
    panNumber: z.string().min(10, "PAN must be 10 characters").optional(),
    panCardUrl: z.string().url("Must be a valid URL").optional(),
    aadhaarFrontUrl: z.string().url("Must be a valid URL").optional(),
    aadhaarBackUrl: z.string().url("Must be a valid URL").optional()
  })
});

const withdrawalRequestSchema = z.object({
  body: z.object({
    idCardId: z.string().optional(),
    method: z.enum(["BANK", "UPI", "WALLET", "MEMBER_WALLET", "VOUCHER_CONVERSION"]).optional(),
    amountPaise: z.number().positive("Amount must be positive"),
    paymentDetails: z.any().optional(),
    idempotencyKey: z.string().optional()
  })
});

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
  adminGeneratePinSchema
};
