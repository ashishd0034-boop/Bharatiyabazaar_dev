const { z } = require("zod");

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name is required"),
    mobile: z.string().length(10, "Mobile must be 10 digits").regex(/^\d+$/),
    email: z.string().email("Invalid email format").optional(),
    address: z.string().optional(),
    pinCode: z.string().optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    referralCode: z.string().optional(),
    side: z.enum(["LEFT", "RIGHT"]).optional()
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

const verifyPinSchema = z.object({
  body: z.object({
    pinCode: z.string().trim().min(4, "PIN code must be at least 4 characters").max(30, "PIN code cannot exceed 30 characters")
  })
});

module.exports = {
  registerSchema,
  loginSchema,
  adminLoginSchema,
  verifyPinSchema
};
