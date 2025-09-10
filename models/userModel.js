const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true }, 
    email: { type: String, required: true, unique: true }, 
    password: { type: String, required: true, select: false }, // ✅ Fixed comma

    phone: { type: String, required: true, unique: true }, 
    status: { type: String, enum: ["active", "blocked"], default: "active" }, 

    createdAt: { type: Date, default: Date.now }, 
// Address Schema with _id for each address
address: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },  // Automatically generates unique ID for each address
    street: { type: String, required: true }, 
    city: { type: String, required: true },  
    state: { type: String, required: true },  
    zipcode: { type: String, required: true }, 
    country: { type: String, required: true },
    latitude: { type: Number },
    longitude: { type: Number }
}]
    // ✅ Cart (Initially Empty)
   , cart: [
        {
            productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
            quantity: { type: Number, default: 1 }
        }
    ], 

    // ✅ Wishlist (Initially Empty)
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    usedCoupons: {
  type: [String],
  default: []
}


}, { timestamps: true });

const User = mongoose.model("User", userSchema);
module.exports = User;
