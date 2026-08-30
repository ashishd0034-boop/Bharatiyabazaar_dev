const { z } = require("zod");

const kycSchema = z.object({
  body: z.object({
    panNumber: z.string().min(10, "PAN must be 10 characters").optional(),
    panCardUrl: z.string().url("Must be a valid URL").optional(),
    aadhaarFrontUrl: z.string().url("Must be a valid URL").optional(),
    aadhaarBackUrl: z.string().url("Must be a valid URL").optional()
  })
});

module.exports = {
  kycSchema
};
