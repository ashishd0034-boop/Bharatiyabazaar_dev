function errorHandler(err, req, res, next) {
  console.error("Error encountered:", err);

  let statusCode = 500;
  let errorCode = "INTERNAL_SERVER_ERROR";
  let message = "An unexpected error occurred.";

  // 1. Zod Validation Error
  if (err.name === "ZodError") {
    statusCode = 400;
    errorCode = "VALIDATION_ERROR";
    message = "Invalid request payload.";
    return res.status(statusCode).json({
      success: false,
      error: { code: errorCode, message, details: err.errors }
    });
  }

  // 2. Prisma P2002: Unique constraint failed (Duplicate entry)
  if (err.code === "P2002") {
    // Prisma 7+: meta.target can be undefined, array, or string
    const target = err.meta?.target;
    let field = "a unique field";
    
    if (Array.isArray(target)) {
      field = target.join(", ");
    } else if (typeof target === "string") {
      field = target;
    }
    
    // Map DB field names to user-friendly names
    const friendlyNames = {
      mobile: "mobile number",
      email: "email address",
      memberCode: "member code",
      cardNumber: "card number",
      globalPosition: "global position",
      runDate: "settlement date"
    };
    
    const friendlyField = friendlyNames[field] || field;
    
    return res.status(409).json({ 
      success: false, 
      error: { 
        code: "DUPLICATE_ENTRY", 
        message: `This ${friendlyField} is already registered. Please use a different one.` 
      } 
    });
  }

  // 3. Prisma P2025: Record not found
  if (err.code === "P2025") {
    statusCode = 404;
    errorCode = "NOT_FOUND";
    message = "The requested record was not found.";
  } 
  
  // 4. Custom Error status / code
  if (err.status || err.statusCode) {
    statusCode = err.status || err.statusCode;
    errorCode = err.code || (statusCode === 403 ? "FORBIDDEN" : statusCode === 401 ? "UNAUTHORIZED" : statusCode === 404 ? "NOT_FOUND" : "BAD_REQUEST");
    message = err.message;
  }
  else if (err.message && (err.message.includes("Invalid") || err.message.includes("Cannot purchase"))) {
    statusCode = 400;
    errorCode = "BAD_REQUEST";
    message = err.message;
  }

  // 5. Default fallback response
  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message
    }
  });
}

module.exports = errorHandler;
