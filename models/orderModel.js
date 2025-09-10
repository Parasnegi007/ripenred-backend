const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: function () {
      return this.isRegisteredUser;
    }
  },
  userName: {
    type: String,
    required: function () {
      return this.isRegisteredUser;
    }
  },
  userEmail: {
    type: String,
    required: function () {
      return this.isRegisteredUser;
    }
  },
  userPhone: {
    type: String,
    required: function () {
      return this.isRegisteredUser;
    }
  },
  guestName: {
    type: String,
    required: function () {
      return !this.isRegisteredUser;
    }
  },
  guestEmail: {
    type: String,
    required: function () {
      return !this.isRegisteredUser;
    }
  },
  guestPhone: {
    type: String,
    required: function () {
      return !this.isRegisteredUser;
    }
  },
  isRegisteredUser: {
    type: Boolean,
    default: false
  },

  // ✅ User-friendly Order ID
  orderId: {
    type: String,
    unique: true,
    required: true
  },

  // ✅ Idempotency Key to prevent duplicate orders
  idempotencyKey: {
    type: String,
    unique: true,
    required: true,
    index: true
  },

  // ✅ Tracking info
  trackingId: {
    type: String,
    default: null
  },
  courierPartner: {
    type: String,
    default: null
  },

  // ✅ Order Items
  orderItems: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
      subtotal: { type: Number, required: true }
    }
  ],

  // ✅ Shipping Address
  shippingAddress: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipcode: { type: String, required: true },
    country: { type: String, required: true },
    latitude: { type: Number },
    longitude: { type: Number }
  },

  paymentMethod: {
    type: String,
    enum: ["razorpay", "phonepe"],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ["Pending", "Paid", "Failed", "Refunded"],
    default: "Pending"
  },
  transactionId: { type: String },
  merchantTransactionId: { type: String }, // For PhonePe status checks
  phonePePaymentData: { type: mongoose.Schema.Types.Mixed }, // PhonePe payment response data
  orderStatus: {
    type: String,
    enum: ["Pending", "Processing", "Shipped", "Delivered", "Canceled"],
    default: "Pending"
  },

  // ✅ Total Pricing
  totalPrice: { type: Number, required: true },

  // ✅ New field: Applied Coupons
  appliedCoupons: {
    type: [String],
    default: []
  },
discountAmount: {
  type: Number,
  default: 0
}
,
finalTotal: { type: Number, required: true },
shippingCharges:{type: Number, required: true},
  
  // ✅ Refund Information
  refundDetails: {
    refundId: { type: String },
    phonePeRefundId: { type: String },
    refundAmount: { type: Number },
    refundStatus: { type: String },
    refundDate: { type: Date },
    refundReason: { type: String },
    processedBy: { type: String }
  },
  
  partialRefunds: [{
    refundId: { type: String },
    phonePeRefundId: { type: String },
    refundAmount: { type: Number },
    refundStatus: { type: String },
    refundDate: { type: Date },
    refundReason: { type: String },
    processedBy: { type: String }
  }],
  
  totalRefunded: {
    type: Number,
    default: 0
  },
  
  orderDate: { type: Date, default: Date.now }

}, { timestamps: true });

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;
