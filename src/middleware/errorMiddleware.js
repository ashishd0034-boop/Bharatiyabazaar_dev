function errorHandler(err, req, res, next) {
  console.error("Error encountered:", err);

  let statusCode = 500;
  let errorCode = "INTERNAL_SERVER_ERROR";
  let message = "An unexpected error occurred.";

  if (err.name === "ZodError") {
    statusCode = 400;
    errorCode = "VALIDATION_ERROR";
    message = "Invalid request payload.";
    return res.status(statusCode).json({
      success: false,
      error: { code: errorCode, message, details: err.errors }
    });
  }

  // Prisma error handling
  if (err.code === "P2002") {
    statusCode = 409;
    errorCode = "CONFLICT";
    message = `A record with this value already exists: ${err.meta?.target}`;
  } else if (err.code === "P2025") {
    statusCode = 404;
    errorCode = "NOT_FOUND";
    message = "The requested record was not found.";
  } else if (err.message && err.message.includes("Invalid")) {
    // Custom throw
    statusCode = 400;
    errorCode = "BAD_REQUEST";
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message
    }
  });
}

module.exports = errorHandler;
