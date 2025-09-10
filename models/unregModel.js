const mongoose = require("mongoose");

const unregSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: [
        {
            street: { type: String, required: true },
            city: { type: String, required: true },
            state: { type: String, required: true },
            zipcode: { type: String, required: true },
            country: { type: String, required: true },
            latitude: { type: Number },
            longitude: { type: Number }
        }
    ],
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const UnregUser = mongoose.model("UnregUser", unregSchema);
module.exports = UnregUser;
