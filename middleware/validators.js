const { body, param, query } = require('express-validator');

// User registration validation
const validateUserRegistration = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Name must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('Name can only contain letters and spaces!'),
    
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail(),
    
    body('phone')
        .isMobilePhone()
        .withMessage('Invalid phone number format!'),
    
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters!')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number!'),
    
    body('otp')
        .isLength({ min: 6, max: 6 })
        .withMessage('OTP must be exactly 6 digits!')
        .isNumeric()
        .withMessage('OTP must contain only numbers!')
];

// User login validation
const validateUserLogin = [
  body()
    .custom(body => {
      if ((!body.email || !/\S+@\S+\.\S+/.test(body.email)) &&
          (!body.phone || !/^[0-9]{10}$/.test(body.phone))) {
        throw new Error('A valid email or phone number is required!');
      }
      return true;
    }),
  body('password').notEmpty().withMessage('Password is required!')
];


// Email validation
const validateEmail = [
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail()
];

// OTP validation
const validateOTP = [
    body('otp')
        .isLength({ min: 6, max: 6 })
        .withMessage('OTP must be exactly 6 digits!')
        .isNumeric()
        .withMessage('OTP must contain only numbers!')
];

// Password reset validation
const validatePasswordReset = [
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail(),
    
    body('otp')
        .isLength({ min: 6, max: 6 })
        .withMessage('OTP must be exactly 6 digits!')
        .isNumeric()
        .withMessage('OTP must contain only numbers!'),
    
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters!')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number!')
];

// Contact form validation
const validateContactForm = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Name must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('Name can only contain letters and spaces!'),
    
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail(),
    
    body('message')
        .trim()
        .isLength({ min: 1, max: 1000 })
        .withMessage('Message must be between 10 and 1000 characters!')
];

// Address validation
const validateAddress = [
    body('street')
        .trim()
        .isLength({ min: 5, max: 200 })
        .withMessage('Street address must be between 5 and 200 characters!'),
    
    body('city')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('City must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('City can only contain letters and spaces!'),
    
    body('state')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('State must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('State can only contain letters and spaces!'),
    
    body('zipcode')
        .trim()
        .isLength({ min: 5, max: 10 })
        .withMessage('Zipcode must be between 5 and 10 characters!')
        .matches(/^[0-9\-\s]+$/)
        .withMessage('Invalid zipcode format!'),
    
    body('country')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Country must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('Country can only contain letters and spaces!'),
    
    body('latitude')
        .optional()
        .isFloat({ min: -90, max: 90 })
        .withMessage('Latitude must be a valid number between -90 and 90!'),
    
    body('longitude')
        .optional()
        .isFloat({ min: -180, max: 180 })
        .withMessage('Longitude must be a valid number between -180 and 180!')
];

// Product ID validation
const validateProductId = [
    param('productId')
        .isMongoId()
        .withMessage('Invalid product ID format!')
];

const validateId = [
  param("id")
    .isMongoId()
    .withMessage("Invalid ID format!")
];

// Cart validation
const validateCartItem = [
    body('productId')
        .isMongoId()
        .withMessage('Invalid product ID format!'),
    
    body('quantity')
        .isInt({ min: 1, max: 99 })
        .withMessage('Quantity must be between 1 and 99!')
];

// Search query validation
const validateSearchQuery = [
    query('query')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Search query must be between 1 and 100 characters!')
];

// Order validation
const validateOrderCreation = [
    body('cartItems')
        .isArray({ min: 1 })
        .withMessage('Cart must contain at least one item!'),
    
    body('cartItems.*.productId')
        .isMongoId()
        .withMessage('Invalid product ID format!'),
    
    body('cartItems.*.quantity')
        .isInt({ min: 1, max: 99 })
        .withMessage('Quantity must be between 1 and 99!'),
    
    body('shippingAddress')
        .notEmpty()
        .withMessage('Shipping address is required!'),
    
    body('shippingAddress.street')
        .trim()
        .isLength({ min: 5, max: 100 })
        .withMessage('Street address must be between 5 and 100 characters!'),
    
    body('shippingAddress.city')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('City must be between 2 and 50 characters!'),
    
    body('shippingAddress.state')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('State must be between 2 and 50 characters!'),
    
    body('shippingAddress.zipcode')
        .trim()
        .isLength({ min: 5, max: 10 })
        .withMessage('Zipcode must be between 5 and 10 characters!'),
    
    body('paymentMethod')
        .notEmpty()
        .withMessage('Payment method is required!'),
    
    body('totalPrice')
        .isFloat({ min: 0 })
        .withMessage('Total price must be a positive number!'),
    
    // Guest user info validation - only validate if userInfo is provided
    body('userInfo')
        .optional()
        .custom((value) => {
            if (value === undefined || value === null) {
                return true; // Allow undefined/null for logged-in users
            }
            
            // If userInfo is provided, validate its fields
            if (typeof value === 'object' && value !== null) {
                if (value.name && (value.name.length < 2 || value.name.length > 50)) {
                    throw new Error('Guest name must be between 2 and 50 characters!');
                }
                if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
                    throw new Error('Invalid guest email format!');
                }
                if (value.phone && !/^[0-9]{10}$/.test(value.phone)) {
                    throw new Error('Invalid guest phone number format!');
                }
            }
            return true;
        })
        .withMessage('Invalid guest user information!'),
    
    body('userInfo.name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Guest name must be between 2 and 50 characters!'),
    
    body('userInfo.email')
        .optional()
        .isEmail()
        .withMessage('Invalid guest email format!'),
    
    body('userInfo.phone')
        .optional()
        .isMobilePhone()
        .withMessage('Invalid guest phone number format!')
];

// Track order validation
const validateTrackOrder = [
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail(),
    
    body('phone')
        .isMobilePhone()
        .withMessage('Invalid phone number format!'),
    
    body('orderId')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Order ID must be between 1 and 50 characters!')
];

// Product validation
const validateProductCreation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 500 })
        .withMessage('Product name must be between 2 and 100 characters!')
        .matches(/^[a-zA-Z0-9\s\-\.()]+$/)
        .withMessage('Product name can only contain letters, numbers, spaces, hyphens, and dots!'),
    
    body('price')
        .isFloat({ min: 0.01 })
        .withMessage('Price must be a positive number greater than 0!'),
    
    body('mrp')
        .isFloat({ min: 0.01 })
        .withMessage('MRP must be a positive number greater than 0!')
        .custom((value, { req }) => {
            if (parseFloat(value) < parseFloat(req.body.price)) {
                throw new Error('MRP cannot be less than selling price!');
            }
            return true;
        }),
    
    body('description')
        .optional()
        .trim()
        .isLength({ max: 10000 })
        .withMessage('Description cannot exceed 1000 characters!'),
    
    body('categoryId')
        .isMongoId()
        .withMessage('Invalid category ID format!'),
    
    body('featured')
        .optional()
        .isBoolean()
        .withMessage('Featured must be true or false!'),
    
    body('sale')
        .optional()
        .isBoolean()
        .withMessage('Sale must be true or false!'),
    
    body('outOfStock')
        .optional()
        .isBoolean()
        .withMessage('Out of stock must be true or false!'),
    
    body('stock')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Stock must be a non-negative integer!')
];

// Product update validation
const validateProductUpdate = [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 500 })
        .withMessage('Product name must be between 2 and 100 characters!')
        .matches(/^[a-zA-Z0-9\s\-\.()]+$/)
        .withMessage('Product name can only contain letters, numbers, spaces, hyphens, and dots!'),
    
    body('price')
        .optional()
        .isFloat({ min: 0.01 })
        .withMessage('Price must be a positive number greater than 0!'),
    
    body('mrp')
        .optional()
        .isFloat({ min: 0.01 })
        .withMessage('MRP must be a positive number greater than 0!')
        .custom((value, { req }) => {
            if (value && req.body.price && parseFloat(value) < parseFloat(req.body.price)) {
                throw new Error('MRP cannot be less than selling price!');
            }
            return true;
        }),
    
    body('description')
        .optional()
        .trim()
        .isLength({ max: 10000 })
        .withMessage('Description cannot exceed 1000 characters!'),
    
    body('categoryId')
        .optional()
        .isMongoId()
        .withMessage('Invalid category ID format!'),
    
    body('featured')
        .optional()
        .isBoolean()
        .withMessage('Featured must be true or false!'),
    
    body('sale')
        .optional()
        .isBoolean()
        .withMessage('Sale must be true or false!'),
    
    body('outOfStock')
        .optional()
        .isBoolean()
        .withMessage('Out of stock must be true or false!'),
    
    body('stock')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Stock must be a non-negative integer!')
];

// Category ID validation
const validateCategoryId = [
    param('id')
        .isMongoId()
        .withMessage('Invalid category ID format!')
];

// Category ID validation for /category/:categoryId
const validateCategoryParamId = [
    param('categoryId')
        .isMongoId()
        .withMessage('Invalid category ID format!')
];

// Dashboard validation
const validateTimePeriod = [
    query('timePeriod')
        .isIn(['daily', 'weekly', 'monthly', 'yearly'])
        .withMessage('Time period must be one of: daily, weekly, monthly, yearly!')
];

// Order ID validation (different from product ID)
const validateOrderId = [
    param('id')
        .isMongoId()
        .withMessage('Invalid order ID format!')
];

// Order ID string validation
const validateOrderIdString = [
    param('orderId')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Order ID must be between 3 and 50 characters!')
        .matches(/^[a-zA-Z0-9\-]+$/)
        .withMessage('Order ID format is invalid!')
];

// Category validation
const validateCategoryCreation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Category name must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z0-9\s\-]+$/)
        .withMessage('Category name can only contain letters, numbers, spaces, and hyphens!'),
    
    body('description')
        .trim()
        .isLength({ min: 5, max: 500 })
        .withMessage('Description must be between 5 and 500 characters!'),
    
    body('slug')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Slug must be between 2 and 50 characters!')
        .matches(/^[a-z0-9\-]+$/)
        .withMessage('Slug can only contain lowercase letters, numbers, and hyphens!')
        .custom(value => {
            if (value.startsWith('-') || value.endsWith('-')) {
                throw new Error('Slug cannot start or end with a hyphen!');
            }
            if (value.includes('--')) {
                throw new Error('Slug cannot contain consecutive hyphens!');
            }
            return true;
        }),
    
    body('featured')
        .optional()
        .isBoolean()
        .withMessage('Featured must be true or false!')
];

// Category update validation
const validateCategoryUpdate = [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Category name must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z0-9\s\-]+$/)
        .withMessage('Category name can only contain letters, numbers, spaces, and hyphens!'),
    
    body('description')
        .optional()
        .trim()
        .isLength({ min: 5, max: 500 })
        .withMessage('Description must be between 5 and 500 characters!'),
    
    body('slug')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Slug must be between 2 and 50 characters!')
        .matches(/^[a-z0-9\-]+$/)
        .withMessage('Slug can only contain lowercase letters, numbers, and hyphens!')
        .custom(value => {
            if (value && (value.startsWith('-') || value.endsWith('-'))) {
                throw new Error('Slug cannot start or end with a hyphen!');
            }
            if (value && value.includes('--')) {
                throw new Error('Slug cannot contain consecutive hyphens!');
            }
            return true;
        }),
    
    body('featured')
        .optional()
        .isBoolean()
        .withMessage('Featured must be true or false!')
];

// Seller validation
const validateSellerRegistration = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Name must be between 2 and 50 characters!')
        .matches(/^[a-zA-Z\s]+$/)
        .withMessage('Name can only contain letters and spaces!'),
    
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail(),
    
    body('phone')
        .isMobilePhone()
        .withMessage('Invalid phone number format!'),
    
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters!')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number!'),
    
    body('vendorName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Vendor name must be between 2 and 100 characters!')
        .matches(/^[a-zA-Z0-9\s\-\.&]+$/)
        .withMessage('Vendor name can only contain letters, numbers, spaces, hyphens, dots, and ampersands!'),
    
    body('address')
        .trim()
        .isLength({ min: 10, max: 200 })
        .withMessage('Address must be between 10 and 200 characters!')
];

// Seller login validation
const validateSellerLogin = [
    body('emailOrPhone')
        .notEmpty()
        .withMessage('Email or phone is required!')
        .custom(value => {
            // Check if it's an email or phone
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const phoneRegex = /^[+]?[0-9\s\-()]+$/;
            
            if (!emailRegex.test(value) && !phoneRegex.test(value)) {
                throw new Error('Must be a valid email or phone number!');
            }
            return true;
        }),
    
    body('password')
        .notEmpty()
        .withMessage('Password is required!')
        .isLength({ min: 1 })
        .withMessage('Password cannot be empty!')
];

// Seller password reset validation
const validateSellerPasswordReset = [
    body('email')
        .isEmail()
        .withMessage('Invalid email format!')
        .normalizeEmail(),
    
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters!')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number!')
];

module.exports = {
    validateUserRegistration,
    validateUserLogin,
    validateEmail,
    validateOTP,
    validatePasswordReset,
    validateContactForm,
    validateAddress,
    validateProductId,
    validateCartItem,
    validateSearchQuery,
    validateOrderCreation,
    validateTrackOrder,
    validateProductCreation,
    validateProductUpdate,
    validateCategoryId,
    validateTimePeriod,
    validateOrderId,
    validateOrderIdString,
    validateCategoryCreation,
    validateCategoryUpdate,
    validateSellerRegistration,
    validateSellerLogin,
    validateSellerPasswordReset,
    validateId,
    validateCategoryParamId
};
