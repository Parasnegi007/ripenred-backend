const jwt = require('jsonwebtoken');
const User = require('../models/userModel'); // Added import for User model

const authMiddleware = async function (req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized! Token missing." });
    }

    const token = authHeader.split(" ")[1]; // ✅ Extract Bearer token correctly

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ message: 'Account deleted. Please contact support.' });
        }
        if (user.status === 'blocked') {
            return res.status(401).json({ message: 'Account blocked. Please contact support.' });
        }
        req.user = user;
        req.userId = user._id;
        req.user.userId = user._id;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

module.exports = authMiddleware;
