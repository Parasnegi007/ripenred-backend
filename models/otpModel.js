const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    email: { type: String, required: false },  // Email (optional)
    phone: { type: String, required: false },  // Phone (optional)
    otp: { type: String, required: true },  // OTP code
    createdAt: { type: Date, default: Date.now, expires: 300 }  // OTP expires in 5 mins
});

const OTP = mongoose.model('OTP', otpSchema);
module.exports = OTP;
