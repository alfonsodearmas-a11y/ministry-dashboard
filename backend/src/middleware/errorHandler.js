const { logger } = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';

  // Log error
  if (statusCode >= 500) {
    logger.error('Server error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.id
    });
  } else {
    logger.warn('Client error', {
      error: err.message,
      code,
      path: req.path,
      method: req.method
    });
  }

  // Handle specific PostgreSQL errors
  if (err.code === '23505') { // Unique violation
    statusCode = 409;
    message = 'Resource already exists';
    code = 'DUPLICATE_ENTRY';
  }

  if (err.code === '23503') { // Foreign key violation
    statusCode = 400;
    message = 'Referenced resource does not exist';
    code = 'FOREIGN_KEY_VIOLATION';
  }

  if (err.code === '23514') { // Check constraint violation
    statusCode = 400;
    message = 'Data validation failed';
    code = 'VALIDATION_ERROR';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    }
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Resource not found',
      code: 'NOT_FOUND',
      path: req.path
    }
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { AppError, errorHandler, notFoundHandler, asyncHandler };
