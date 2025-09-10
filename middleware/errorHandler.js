const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Log error to file
const logError = (error, req) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        error: {
            message: error.message,
            stack: error.stack,
            name: error.name
        },
        body: req.body,
        params: req.params,
        query: req.query
    };

    const logFile = path.join(logsDir, `error-${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
};

// Validation error handler
const handleValidationErrors = (errors) => {
    const formattedErrors = errors.array().map(error => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value
    }));

    return {
        success: false,
        message: 'Validation failed',
        errors: formattedErrors,
        timestamp: new Date().toISOString()
    };
};

// MongoDB error handler
const handleMongoError = (error) => {
    if (error.code === 11000) {
        // Duplicate key error
        const field = Object.keys(error.keyValue)[0];
        const value = error.keyValue[field];
        return {
            success: false,
            message: `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' already exists`,
            error: 'DUPLICATE_ENTRY',
            timestamp: new Date().toISOString()
        };
    }

    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(val => ({
            field: val.path,
            message: val.message
        }));
        return {
            success: false,
            message: 'Validation failed',
            errors,
            timestamp: new Date().toISOString()
        };
    }

    if (error.name === 'CastError') {
        return {
            success: false,
            message: `Invalid ${error.path}: ${error.value}`,
            error: 'INVALID_ID',
            timestamp: new Date().toISOString()
        };
    }

    return null;
};

// JWT error handler
const handleJWTError = (error) => {
    if (error.name === 'JsonWebTokenError') {
        return {
            success: false,
            message: 'Invalid token',
            error: 'INVALID_TOKEN',
            timestamp: new Date().toISOString()
        };
    }

    if (error.name === 'TokenExpiredError') {
        return {
            success: false,
            message: 'Token has expired',
            error: 'EXPIRED_TOKEN',
            timestamp: new Date().toISOString()
        };
    }

    return null;
};

// Main error handler middleware
const errorHandler = (error, req, res, next) => {
    logError(error, req);
  
    let response = handleMongoError(error) || handleJWTError(error);
  
    if (!response) {
      const isDevelopment = process.env.NODE_ENV === 'development';
  
      // Use the error.message if exists, fallback to generic if not
      const friendlyMessage = error.message && error.message !== '' ? error.message : 'Internal server error';
  
      response = {
        success: false,
        message: friendlyMessage,
        error: isDevelopment ? error.stack : 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      };
    }
  
    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json(response);
  };
  

// 404 handler
const notFoundHandler = (req, res, next) => {
    const response = {
        success: false,
        message: `Route ${req.originalUrl} not found`,
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString()
    };
    
    res.status(404).json(response);
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
    handleValidationErrors,
    logError
};
