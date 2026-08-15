const { z } = require("zod");

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name is required"),
    mobile: z.string().length(10, "Mobile must be 10 digits").regex(/^\d+$/),
    email: z.string().email("Invalid email format").optional(),
    address: z.string().optional(),
    pinCode: z.string().optional(),
    password: z.string().min(6, "Password must be at least 6 characters")
  })
});

const loginSchema = z.object({
  body: z.object({
    mobile: z.string().length(10, "Mobile must be 10 digits").regex(/^\d+$/),
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
    idCardId: z.string().min(1, "ID Card ID is required"),
    method: z.enum(["BANK", "UPI", "WALLET", "CRYPTO"]),
    amountPaise: z.number().positive("Amount must be positive")
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
