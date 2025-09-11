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

// Temporarily disable CSP for debugging
app.use(helmet({
  contentSecurityPolicy: false,
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
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'https://ripenred.com',
      'https://www.ripenred.com',
      'https://seller.ripenred.com',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5000'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('🚫 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-requested-with',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-CSRF-Token',
    'X-Idempotency-Key'
  ],
  exposedHeaders: ['Content-Length', 'X-Kuma-Revision']
};

// Apply CORS before routes
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

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

// ✅ CORS Test Endpoint
app.get('/api/cors-test', (req, res) => {
  res.status(200).json({ 
    message: 'CORS is working!',
    origin: req.headers.origin || 'no-origin',
    timestamp: new Date().toISOString()
  });
});

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

