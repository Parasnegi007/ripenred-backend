const jwt = require("jsonwebtoken");
const Seller = require("../seller-backend/models/sellerModel"); // Adjust path if needed

const authSeller = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Seller token missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const seller = await Seller.findById(decoded.id).select("-password");

    if (!seller) {
      return res.status(401).json({ message: "Invalid seller token" });
    }

    req.seller = seller; // Attach seller to request
    next();
  } catch (err) {
    console.error("❌ Seller Auth Error:", err.message);
    res.status(401).json({ message: "Invalid or expired seller token" });
  }
};

module.exports = authSeller;
