const express = require("express");
const router = express.Router();
const Seller = require("../models/sellerModel");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const authSeller = require("../../middleware/authSeller");
const OTP = require('../../models/otpModel');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');

// Import middleware
const { asyncHandler } = require('../../middleware/errorHandler');
const {
  authLimiter,
  emailLimiter,
  otpLimiter
} = require('../../middleware/rateLimiter');
const {
   validateSellerRegistration,
   validateSellerLogin,
  validateOTP,
   validateSellerPasswordReset
} = require('../../middleware/validators');
// ✅ Helper: Generate JWT
const generateToken = (sellerId) => {
  return jwt.sign({ id: sellerId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};



// 🔹 1️⃣ Send OTP via Email
router.post('/send-otp-email', emailLimiter, [  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
], asyncHandler(async (req, res) => {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }

    const { email } = req.body;

    // Check if seller exists with this email
    const existingSeller = await Seller.findOne({ email });
    if (!existingSeller) {
        return res.status(404).json({
            success: false,
            message: 'No seller found with this email address'
        });
    }

    // Delete any existing OTPs for this email
    await OTP.deleteMany({ email });

    // Generate a 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in database (expires in 5 mins)
    await OTP.create({ email, otp: otpCode });

    // Set up Nodemailer transporter
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    // Email content
    const mailOptions = {
         from: `"${process.env.STORE_NAME || 'Ripe’n Red'}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP for verification is: ${otpCode}. It is valid for 5 minutes.`,
    };

    // Send email
    await transporter.sendMail(mailOptions);

    res.status(200).json({ 
        success: true,
        message: "OTP sent successfully!"
    });
}));

// ✅ @route   POST /api/sellers/signup
// ✅ @desc    Register a new seller
router.post("/signup", authLimiter,  validateSellerRegistration, asyncHandler(async (req, res) => {
  const { name, email, phone, password, vendorName, address } = req.body;

  const newSeller = new Seller({
    name,
    email,
    phone,
    vendorName,
    password,
    address,
  });

  await newSeller.save();

  const token = generateToken(newSeller._id);

  res.status(201).json({
    message: "Seller registered successfully",
    token,
    seller: {
      id: newSeller._id,
      name: newSeller.name,
      email: newSeller.email,
      phone: newSeller.phone,
      vendorName: newSeller.vendorName,
    },
  });
}));

// ✅ @route   POST /api/sellers/login
// ✅ @desc    Authenticate seller & get token
router.post("/login", authLimiter,  validateSellerLogin, asyncHandler(async (req, res) => {
  const { emailOrPhone, password } = req.body;

  // Find seller by email or phone
  const seller = await Seller.findOne({
    $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
  }).select("+password");

  const isMatch = await seller.comparePassword(password);

  const token = generateToken(seller._id);

  res.json({
    token,
    seller: {
      id: seller._id,
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
      vendorName: seller.vendorName,
    },
  });
}));

// ✅ @route   GET /api/sellers/me
// ✅ @desc    Get seller profile (protected)
router.get("/me", authLimiter, authSeller, asyncHandler(async (req, res) => {
  res.json({
    id: req.seller._id,
    name: req.seller.name,
    email: req.seller.email,
    phone: req.seller.phone,
    vendorName: req.seller.vendorName,
    address: req.seller.address,
  });
}));


router.post('/forgot-password', emailLimiter, asyncHandler(async (req, res) => {
    const { email } = req.body;

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.create({ email, otp: otpCode });

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Password Reset OTP",
        text: `Your OTP for password reset is: ${otpCode}. It is valid for 5 minutes.`,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: "OTP sent successfully!" });
}));

// 🔹 6️⃣ Verify OTP Route (Move Above module.exports)
router.post('/verify-otp', otpLimiter, validateOTP, asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const otpRecord = await OTP.findOne({ email, otp });
  if (!otpRecord) {
    return res.status(400).json({ message: 'Invalid OTP' });
  }
  const seller = await Seller.findOne({ email });
  if (!seller) {
    return res.status(404).json({ message: 'Seller not found' });
  }
  // Issue new, verified JWT
  const token = generateToken(seller._id);
  res.status(200).json({
    message: "OTP Verified! Authentication complete.",
    token,             // <- new token sent here
    seller: {
      id: seller._id,
      name: seller.name,
      email: seller.email,
      vendorName: seller.vendorName,
    }
  });
}));

router.post("/forgot-password/reset", authLimiter, validateSellerPasswordReset, asyncHandler(async (req, res) => {
  const { email, newPassword } = req.body;

  const seller = await Seller.findOne({ email });

  const salt = await bcrypt.genSalt(10);
  seller.password = newPassword; // assign plain password
await seller.save();           // pre-save hook will hash it

  res.json({ message: "Password updated successfully" });
}));
module.exports = router;
