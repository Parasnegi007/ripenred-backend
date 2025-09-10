const rateLimit = require('express-rate-limit');

// Auth rate limiter - stricter for login/register
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per 15 minutes
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// OTP rate limiter - very strict for OTP sending
const otpLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // Limit each IP to 3 OTP requests per 5 minutes
    message: {
        error: 'Too many OTP requests, please try again later.',
        retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Email rate limiter for contact forms
const emailLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5, // Limit each IP to 5 emails per 10 minutes
    message: {
        error: 'Too many email requests, please try again later.',
        retryAfter: '10 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Payment rate limiter - strict for order creation and payment verification
const paymentLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // Limit each IP to 10 payment attempts per 5 minutes
    message: {
        error: 'Too many payment attempts, please try again later.',
        retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes
    max: 1000000, // Limit each IP to 1000000 requests per 2 minutes
    message: {
        error: 'Too many API requests, please try again later.',
        retryAfter: '2 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limit for localhost in development
    skip: (req) => {
        const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.hostname === 'localhost';
        const isDevelopment = process.env.NODE_ENV !== 'production';
        return isLocalhost && isDevelopment;
    }
});


module.exports = {
    authLimiter,
    otpLimiter,
    emailLimiter,
    apiLimiter,
    paymentLimiter
};
