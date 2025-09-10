const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const sellerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Seller name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
    },
    vendorName: {
      type: String,
      required: [true, "Shop/Vendor name is required"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    address: {
      street: { type: String },
      city: { type: String },
      state: { type: String },
      zipcode: { type: String },
      country: { type: String, default: "India" },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// 🔐 Hash password before save
sellerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 🔓 Compare password for login
sellerSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const Seller = mongoose.model("Seller", sellerSchema);

module.exports = Seller;
