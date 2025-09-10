const express = require('express');
const router = express.Router();

// Serve frontend configuration from .env
router.get('/api-config', (req, res) => {
    const config = {
        API_BASE_URL: process.env.BACKEND_URL || 'http://localhost:5000',
        timestamp: new Date().toISOString()
    };
    
    res.json(config);
});

module.exports = router;
