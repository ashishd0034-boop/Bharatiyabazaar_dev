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
    memberId: z.string().min(1, "Member ID is required"),
    idCardId: z.string().optional(),
    amountPaise: z.number().positive("Amount must be positive")
  })
});

const settingUpdateSchema = z.object({
  body: z.object({
    value: z.string().min(1, "Value is required"),
    description: z.string().optional()
  })
});

module.exports = {
  registerSchema,
  loginSchema,
  adminLoginSchema,
  kycSchema,
  withdrawalRequestSchema,
  vendorSaleSchema,
  settingUpdateSchema
};
