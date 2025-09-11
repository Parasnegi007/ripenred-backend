require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./database'); // Import MongoDB connection
const multer = require('multer');
const notificationService = require('./services/notificationService');

const app = express();
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path'); // ✅ Add this line
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const hpp = require("hpp");

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com" // Add unpkg for Leaflet CSS
      ],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'", // Allow eval for some libraries
        "https://checkout.razorpay.com", 
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.socket.io",
        "https://code.jquery.com", // Add jQuery CDN
        "https://ajax.googleapis.com", // Add Google CDN
        "https://www.googletagmanager.com" // Add Google Analytics
      ],
      "script-src-attr": ["'unsafe-inline'"], // Allow inline event handlers
      "script-src-elem": [
        "'self'",
        "'unsafe-inline'",
        "https://checkout.razorpay.com", 
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://code.jquery.com",
        "https://ajax.googleapis.com",
        "https://www.googletagmanager.com" // Add Google Analytics
      ],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: [
        "'self'", 
        "https://api.postalpincode.in",
        "https://lumberjack.razorpay.com", // Add Razorpay tracking
        "https://www.google-analytics.com", // Add Google Analytics
        "https://analytics.google.com", // Add Google Analytics
        "https://ripenred.com",
        "https://www.ripenred.com",
        "https://seller.ripenred.com",
        "https://cdn.jsdelivr.net", // Add jsdelivr for source maps
        "https://cdnjs.cloudflare.com" // Add cdnjs for source maps
      ],
      frameSrc: [
        "'self'", 
        "https://checkout.razorpay.com",
        "https://api.razorpay.com" // Add Razorpay API for iframe
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Enable compression
app.use(compression());

// Setup request logging
app.use(morgan('combined'));

// Rate limiting
const { apiLimiter } = require('./middleware/rateLimiter');
const { auditMiddleware } = require('./middleware/auditLogger');
app.use(apiLimiter);

// Request Size Limits and Body Parsing
app.use(express.json({ 
  limit: '10mb', // Limit JSON payload size
  verify: (req, res, buf) => {
    // Store raw body for signature verification
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// ✅ Audit Logging Middleware (moved after body parsing)
app.use(auditMiddleware);

// Input Sanitization Middleware
app.use(mongoSanitize()); // Prevent NoSQL injection
app.use(xss()); // Prevent XSS attacks
app.use(hpp()); // Prevent HTTP Parameter Pollution

const categoryRoutes = require('./seller-backend/routes/categoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const sellerRoutes = require("./seller-backend/routes/sellerRoutes");
const authSeller = require("./middleware/authSeller");
const invoiceRoutes = require('./routes/invoiceRoutes');

// ✅ Connect to MongoDB
connectDB();

// ✅ Enable CORS for production (Restrict to specific domains)
const corsOptions = {
  origin: [
    process.env.FRONTEND_URL || 'https://ripenred.com',
    'https://www.ripenred.com',
    'https://seller.ripenred.com'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
};
app.use(cors(corsOptions));

// Trust proxy for production (when behind reverse proxy/nginx)
app.set('trust proxy', 1);

// ✅ Register Routes
app.use('/api/users', require('./routes/userRoutes'));       // 🔹 User Routes
app.use('/api/products', require('./routes/productRoutes')); // 🔹 Product Routes
app.use('/api/dashboard', require('./seller-backend/routes/dashboardRoutes')); 
app.use('/api/categories', categoryRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/api/orders', orderRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/notifications', require('./routes/notificationRoutes')); // 🔹 Notification Routes
app.use('/api/emails', require('./routes/emailRoutes')); // 🔹 Email Routes
app.use('/api/config', require('./routes/configRoutes')); // 🔹 Frontend Config Route
app.use('/store/assets/images', express.static(path.join(__dirname, '../store/assets/images')));
app.use('/assets', express.static(path.join(__dirname, 'assets'))); // 🔹 Backend Assets Route for Email Images
app.use("/api/sellers", sellerRoutes);

// 🔄 Serve seller dashboard as static files
app.use('/seller-dashboard', express.static(path.join(__dirname, '../seller-dashboard')));
app.use('/seller', express.static(path.join(__dirname, '../seller-dashboard')));

// 🔄 Serve main store as static files  
app.use('/store', express.static(path.join(__dirname, '../store')));

// ✅ Health Check Endpoint
app.get('/health', (req, res) => {
  const { auditLogger } = require('./middleware/auditLogger');
  
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    storage: auditLogger.getStorageInfo()
  });
});

// ✅ Default route for server status
app.get('/', (req, res) => {
  res.send('🍏 Ripenred API');
});

// ✅ Debug Log: Confirm routes are registered
app._router.stack.forEach((r) => {
  // Route registration logging removed for production
});

// ✅ Import error handling middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// ✅ 404 handler - must be after all routes
app.use(notFoundHandler);

// ✅ Error handling middleware - must be last
app.use(errorHandler);


// ✅ Initialize Auto-Cancel Service
const autoCancelService = require('./services/autoCancelService');

// ✅ Start the server
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  
  // Start auto-cancel service after server starts
  setTimeout(() => {
    autoCancelService.start();
  }, 5000); // Wait 5 seconds for database connection to stabilize
});

// ✅ Graceful shutdown handling
process.on('SIGTERM', () => {
  autoCancelService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  autoCancelService.stop();
  process.exit(0);
});

