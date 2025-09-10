const express = require('express');
const { validationResult } = require('express-validator');
const { authLimiter, apiLimiter } = require('../../middleware/rateLimiter');
const { asyncHandler, handleValidationErrors } = require('../../middleware/errorHandler');
const {
    validateTimePeriod,
    validateOrderId,
    validateOrderIdString
} = require('../../middleware/validators');
const router = express.Router();
const User = require('../../models/userModel');
const Product = require('../../models/productModel');
const Order = require('../../models/orderModel');
const authSeller = require("../../middleware/authSeller");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../utils/cloudinary");
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "quillImages/v1",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{
      width: 400,
      height: 400,
      crop: "limit",
      quality: "auto:best",
      fetch_format: "auto",
      flags: "progressive"
    }]
  }
});

const upload = multer({ storage });

router.post("/image-upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No image uploaded." });

  res.status(200).json({ success: true, url: req.file.path });
});

module.exports = router;

router.get('/stats', authSeller, apiLimiter, asyncHandler(async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalProducts = await Product.countDocuments();
        const totalOrders = await Order.countDocuments();
        // Calculate total sales (revenue from paid orders)
        const paidOrders = await Order.find({ paymentStatus: 'Paid' });
        let totalSales = 0;
        paidOrders.forEach(order => {
            totalSales += order.finalTotal || 0;
        });
        res.json({
            totalUsers,
            totalProducts,
            totalOrders,
            totalSales
        });
    } catch (error) {
        throw error;
    }
}));

// 📌 Fetch Chart Data (Users & Products)

router.get('/chart-data', authSeller, apiLimiter, asyncHandler(async (req, res) => {
  try {
    const timeRanges = ["Daily", "Weekly", "Monthly", "Yearly"];
    let chartData = {
      Users: {},
      Products: {}
    };

    for (let range of timeRanges) {
      chartData.Users[range] = await getUsersData(range);
      chartData.Products[range] = await getProductsData(range);
    }

    res.json(chartData);
  } catch (error) {
    throw error;
  }
}));

// 📌 Helper Functions to Aggregate Data
async function getUsersData(range) {
    const matchStage = getTimeMatchStage(range, "createdAt");
    const users = await User.aggregate([
        { $match: matchStage },
        { $group: { _id: null, count: { $sum: 1 } } }  // ✅ FIXED
    ]);
    return users.length ? users[0].count : 0;
}

async function getProductsData(range) {
    const matchStage = getTimeMatchStage(range, "createdAt");
    const products = await Product.aggregate([
        { $match: matchStage },
        { $group: { _id: null, count: { $sum: 1 } } }  // ✅ FIXED
    ]);
    return products.length ? products[0].count : 0;
}

// 📌 Function to Get Time Filtering Stage for MongoDB Queries
function getTimeMatchStage(range, field) {
    const now = new Date();
    let startDate;

    switch (range) {
        case "Daily":
            startDate = new Date(now.setDate(now.getDate() - 7)); // Last 7 days
            break;
        case "Weekly":
            startDate = new Date(now.setDate(now.getDate() - 30)); // Last 30 days
            break;
        case "Monthly":
            startDate = new Date(now.setFullYear(now.getFullYear() - 1)); // Last 12 months
            break;
        case "Yearly":
            startDate = new Date(now.setFullYear(now.getFullYear() - 5)); // Last 5 years
            break;
        default:
            startDate = new Date("2000-01-01"); // All data
    }

    return { [field]: { $gte: startDate } };
}
// Total Orders API Endpoint for Dashboard

router.get("/orders", authSeller, apiLimiter, validateTimePeriod, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { timePeriod } = req.query;

    const now = new Date();
    let startDate, dateFormat, rangeLength;

    if (timePeriod === "daily") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      rangeLength = 1;
      dateFormat = { day: 'numeric', month: 'short' };
    } else if (timePeriod === "weekly") {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      rangeLength = 7;
      dateFormat = { day: 'numeric', month: 'short' };
    } else if (timePeriod === "monthly") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeLength = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      dateFormat = { day: 'numeric', month: 'short' };
    } else if (timePeriod === "yearly") {
      startDate = new Date(now.getFullYear(), 0, 1);
      rangeLength = 12;
      dateFormat = { month: 'short' };
    } else {
      return res.status(400).json({ message: "Invalid time period" });
    }

    const orders = await Order.find({ createdAt: { $gte: startDate } });

    const statsMap = {};

    for (let i = 0; i < rangeLength; i++) {
      let label;
      if (timePeriod === "yearly") {
        const date = new Date(startDate.getFullYear(), i, 1);
        label = date.toLocaleDateString("en-US", dateFormat);
      } else {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        label = date.toLocaleDateString("en-US", dateFormat);
      }
      statsMap[label] = 0;
    }

    orders.forEach(order => {
      const date = new Date(order.createdAt);
      const label = date.toLocaleDateString("en-US", dateFormat);
      if (statsMap[label] !== undefined) {
        statsMap[label]++;
      }
    });

    const labels = Object.keys(statsMap);
    const data = Object.values(statsMap);

    res.json({ labels, data });
  } catch (error) {
    throw error;
  }
}));
router.get("/all-orders", authSeller, apiLimiter, asyncHandler(async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .populate("userId", "name email phone");

    const formattedOrders = orders.map(order => {
      const isRegistered = order.isRegisteredUser;
      return {
        _id: order._id,
        orderId: order.orderId,
        trackingId: order.trackingId || "N/A",
        courierPartner: order.courierPartner || "N/A",
        isRegisteredUser: isRegistered,
        userName: isRegistered ? order.userId?.name : order.guestName,
        userEmail: isRegistered ? order.userId?.email : order.guestEmail,
        userPhone: isRegistered ? order.userId?.phone : order.guestPhone,
        orderItems: order.orderItems,
        shippingAddress: order.shippingAddress,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        transactionId: order.transactionId,
        orderStatus: order.orderStatus,
        totalPrice: order.totalPrice,
        discountAmount: order.discountAmount,
        finalTotal: order.finalTotal,
        shippingCharges: order.shippingCharges,
        appliedCoupons: order.appliedCoupons,
        orderDate: order.orderDate,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };
    });

    res.json(formattedOrders);
  } catch (error) {
    throw error;
  }
}));
router.patch("/order/:id/status", authSeller, authLimiter, validateOrderId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { status, trackingId, courierPartner } = req.body;

    const updatedFields = { orderStatus: status };
    if (trackingId) updatedFields.trackingId = trackingId;
    if (courierPartner) updatedFields.courierPartner = courierPartner;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updatedFields,
      { new: true }
    ).populate("userId", "name email phone");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isRegistered = order.isRegisteredUser;
    const updatedOrder = {
      _id: order._id,
      orderId: order.orderId,
      trackingId: order.trackingId || "N/A",
      courierPartner: order.courierPartner || "N/A",
      isRegisteredUser: isRegistered,
      userName: isRegistered ? order.userId?.name : order.guestName,
      userEmail: isRegistered ? order.userId?.email : order.guestEmail,
      userPhone: isRegistered ? order.userId?.phone : order.guestPhone,
      orderItems: order.orderItems,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      transactionId: order.transactionId,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      discountAmount: order.discountAmount,
      finalTotal: order.finalTotal,
      shippingCharges: order.shippingCharges,
      appliedCoupons: order.appliedCoupons,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    res.json({ message: "Order updated successfully", order: updatedOrder });
  } catch (error) {
    throw error;
  }
}));
router.get("/order/:id", authSeller, apiLimiter, validateOrderId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const order = await Order.findById(req.params.id).populate("userId", "name email phone");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isRegistered = order.isRegisteredUser;
    const detailedOrder = {
      _id: order._id,
      orderId: order.orderId,
      trackingId: order.trackingId || "N/A",
      courierPartner: order.courierPartner || "N/A",
      isRegisteredUser: isRegistered,
      userName: isRegistered ? order.userId?.name : order.guestName,
      userEmail: isRegistered ? order.userId?.email : order.guestEmail,
      userPhone: isRegistered ? order.userId?.phone : order.guestPhone,
      orderItems: order.orderItems,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      transactionId: order.transactionId,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      discountAmount: order.discountAmount,
      finalTotal: order.finalTotal,
      shippingCharges: order.shippingCharges,
      appliedCoupons: order.appliedCoupons,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    res.json(detailedOrder);
  } catch (error) {
    throw error;
  }
}));
router.get("/order-by-orderid/:orderId", authSeller, apiLimiter, validateOrderIdString, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const order = await Order.findOne({ orderId: req.params.orderId }).populate("userId", "name email phone");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Construct detailed order as before...
    const isRegistered = order.isRegisteredUser;
    const detailedOrder = {
      _id: order._id,
      orderId: order.orderId,
      trackingId: order.trackingId || "N/A",
      courierPartner: order.courierPartner || "N/A",
      isRegisteredUser: isRegistered,
      userName: isRegistered ? order.userId?.name : order.guestName,
      userEmail: isRegistered ? order.userId?.email : order.guestEmail,
      userPhone: isRegistered ? order.userId?.phone : order.guestPhone,
      orderItems: order.orderItems,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      transactionId: order.transactionId,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      discountAmount: order.discountAmount,
      finalTotal: order.finalTotal,
      shippingCharges: order.shippingCharges,
      appliedCoupons: order.appliedCoupons,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    res.json(detailedOrder);
  } catch (error) {
    throw error;
  }
}));


// Update payment status route
router.patch("/order/:id/payment-status", authSeller, authLimiter, validateOrderId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { paymentStatus } = req.body;

    // Validate payment status
    const validPaymentStatuses = ["Pending", "Paid", "Failed", "Refunded"];
    if (!validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({ message: "Invalid payment status" });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { paymentStatus },
      { new: true }
    ).populate("userId", "name email phone");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isRegistered = order.isRegisteredUser;
    const updatedOrder = {
      _id: order._id,
      orderId: order.orderId,
      trackingId: order.trackingId || "N/A",
      courierPartner: order.courierPartner || "N/A",
      isRegisteredUser: isRegistered,
      userName: isRegistered ? order.userId?.name : order.guestName,
      userEmail: isRegistered ? order.userId?.email : order.guestEmail,
      userPhone: isRegistered ? order.userId?.phone : order.guestPhone,
      orderItems: order.orderItems,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      transactionId: order.transactionId,
      orderStatus: order.orderStatus,
      totalPrice: order.totalPrice,
      discountAmount: order.discountAmount,
      finalTotal: order.finalTotal,
      shippingCharges: order.shippingCharges,
      appliedCoupons: order.appliedCoupons,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    res.json({ message: "Payment status updated successfully", order: updatedOrder });
  } catch (error) {
    throw error;
  }
}));

router.get('/users-growth', authSeller, apiLimiter, validateTimePeriod, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
  try {
    const { timePeriod } = req.query;

    const now = new Date();
    let startDate;
    let dateFormat;
    let totalUnits;
    let unitIncrement;

    switch (timePeriod) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        dateFormat = "%H:00";
        totalUnits = 24;
        unitIncrement = (d) => d.setHours(d.getHours() + 1);
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        dateFormat = "%Y-%m-%d";
        totalUnits = 7;
        unitIncrement = (d) => d.setDate(d.getDate() + 1);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFormat = "%Y-%m-%d";
        totalUnits = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        unitIncrement = (d) => d.setDate(d.getDate() + 1);
        break;
      case 'yearly':
        startDate = new Date(now.getFullYear(), 0, 1);
        dateFormat = "%Y-%m";
        totalUnits = 12;
        unitIncrement = (d) => d.setMonth(d.getMonth() + 1);
        break;
      default:
        return res.status(400).json({ message: "Invalid time period" });
    }

    const users = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const userMap = new Map(users.map(u => [u._id, u.count]));

    const labels = [];
    const counts = [];
    const datePointer = new Date(startDate);

    for (let i = 0; i < totalUnits; i++) {
      let label = "";

      if (timePeriod === "daily") {
        label = `${String(datePointer.getHours()).padStart(2, "0")}:00`;
      } else if (timePeriod === "weekly" || timePeriod === "monthly") {
        label = datePointer.toISOString().split("T")[0]; // YYYY-MM-DD
      } else if (timePeriod === "yearly") {
        label = `${datePointer.getFullYear()}-${String(datePointer.getMonth() + 1).padStart(2, "0")}`; // YYYY-MM
      }

      labels.push(label);
      counts.push(userMap.get(label) || 0);
      unitIncrement(datePointer);
    }

    res.json({ labels, data: counts });
  } catch (error) {
    throw error;
  }
}));
// Sales Report API
router.get("/sales-report", authSeller, apiLimiter, asyncHandler(async (req, res) => {
  // Optional: timePeriod in query ("month", "year", "all")
  const { timePeriod = "month" } = req.query;
  const now = new Date();

  // For revenue and paid stats
  let paidMatch = { paymentStatus: "Paid" };
  let groupStage = {};
  let dateFormat = "";
  let rangeStart, rangeEnd;

  if (timePeriod === "month") {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = "%Y-%m-%d";
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
      revenue: { $sum: "$finalTotal" }
    };
  } else if (timePeriod === "year") {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = "%Y-%U";
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
      revenue: { $sum: "$finalTotal" }
    };
  } else if (timePeriod === "all") {
    rangeStart = new Date("2000-01-01");
    rangeEnd = now;
    dateFormat = "%Y-%m";
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
      revenue: { $sum: "$finalTotal" }
    };
  } else {
    return res.status(400).json({ message: "Invalid timePeriod" });
  }

  paidMatch.createdAt = { $gte: rangeStart, $lte: rangeEnd };

  // Revenue chart (paid orders only)
  const chartData = await Order.aggregate([
    { $match: paidMatch },
    { $group: groupStage },
    { $sort: { _id: 1 } }
  ]);

  // All orders for status counts and totalOrders
  const allOrders = await Order.find({ createdAt: { $gte: rangeStart, $lte: rangeEnd } });
  let totalOrders = allOrders.length;
  const orderStatusCounts = {};
  allOrders.forEach(order => {
    const status = order.orderStatus || 'Unknown';
    orderStatusCounts[status] = (orderStatusCounts[status] || 0) + 1;
  });

  // Paid orders for revenue and product stats
  const paidOrders = allOrders.filter(order => order.paymentStatus === 'Paid');
  let totalRevenue = 0, totalProductsSold = 0;
  const productMap = {};
  paidOrders.forEach(order => {
    totalRevenue += order.finalTotal || 0;
    (order.orderItems || []).forEach(item => {
      totalProductsSold += item.quantity || 0;
      if (!productMap[item.name]) productMap[item.name] = 0;
      productMap[item.name] += item.quantity || 0;
    });
  });

  // Find top 5 selling products
  const topProducts = Object.entries(productMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  res.json({
    totalRevenue,
    totalOrders,
    orderStatusCounts,
    averageOrderValue: paidOrders.length ? totalRevenue / paidOrders.length : 0,
    totalProductsSold,
    topProducts,
    revenueChart: chartData.map(d => ({ label: d._id, revenue: d.revenue }))
  });
}));

// Sales Chart API (products sold over time)
router.get('/sales-chart', authSeller, apiLimiter, asyncHandler(async (req, res) => {
  const { timePeriod = 'month' } = req.query;
  const now = new Date();
  let rangeStart, rangeEnd, dateFormat, groupStage;
  if (timePeriod === 'daily') {
    // Last 7 days, group by day
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = '%Y-%m-%d';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      productsSold: { $sum: { $sum: '$orderItems.quantity' } }
    };
  } else if (timePeriod === 'weekly') {
    // Last 8 weeks, group by week
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 55, 0, 0, 0, 0); // 8 weeks * 7 days
    rangeEnd = now;
    dateFormat = '%Y-%U';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      productsSold: { $sum: { $sum: '$orderItems.quantity' } }
    };
  } else if (timePeriod === 'month') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = '%Y-%m-%d';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      productsSold: { $sum: { $sum: '$orderItems.quantity' } }
    };
  } else if (timePeriod === 'year') {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = '%Y-%U';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      productsSold: { $sum: { $sum: '$orderItems.quantity' } }
    };
  } else if (timePeriod === 'all') {
    rangeStart = new Date('2000-01-01');
    rangeEnd = now;
    dateFormat = '%Y-%m';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      productsSold: { $sum: { $sum: '$orderItems.quantity' } }
    };
  } else {
    return res.status(400).json({ message: 'Invalid timePeriod' });
  }
  const match = { paymentStatus: 'Paid', createdAt: { $gte: rangeStart, $lte: rangeEnd } };
  const chartData = await Order.aggregate([
    { $match: match },
    { $unwind: '$orderItems' },
    { $group: {
      _id: groupStage._id,
      productsSold: { $sum: '$orderItems.quantity' }
    } },
    { $sort: { _id: 1 } }
  ]);
  const labels = chartData.map(d => d._id);
  const data = chartData.map(d => d.productsSold);
  res.json({ labels, data });
}));
// Revenue Chart API (revenue over time)
router.get('/revenue-chart', authSeller, apiLimiter, asyncHandler(async (req, res) => {
  const { timePeriod = 'month' } = req.query;
  const now = new Date();
  let rangeStart, rangeEnd, dateFormat, groupStage, labelGenerator, totalUnits;
  if (timePeriod === 'daily' || timePeriod === 'weekly') {
    // Past 7 days
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = '%Y-%m-%d';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      revenue: { $sum: '$finalTotal' }
    };
    totalUnits = 7;
    labelGenerator = () => {
      const labels = [];
      const date = new Date(rangeStart);
      for (let i = 0; i < totalUnits; i++) {
        labels.push(date.toISOString().split('T')[0]);
        date.setDate(date.getDate() + 1);
      }
      return labels;
    };
  } else if (timePeriod === 'month') {
    // Past 30 days
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = '%Y-%m-%d';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      revenue: { $sum: '$finalTotal' }
    };
    totalUnits = 30;
    labelGenerator = () => {
      const labels = [];
      const date = new Date(rangeStart);
      for (let i = 0; i < totalUnits; i++) {
        labels.push(date.toISOString().split('T')[0]);
        date.setDate(date.getDate() + 1);
      }
      return labels;
    };
  } else if (timePeriod === 'year') {
    // Past 52 weeks
    rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 363, 0, 0, 0, 0);
    rangeEnd = now;
    dateFormat = '%Y-%U';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      revenue: { $sum: '$finalTotal' }
    };
    totalUnits = 52;
    labelGenerator = () => {
      const labels = [];
      const date = new Date(rangeStart);
      for (let i = 0; i < totalUnits; i++) {
        const week = getWeekNumber(date);
        labels.push(`${date.getFullYear()}-W${week}`);
        date.setDate(date.getDate() + 7);
      }
      return labels;
    };
  } else if (timePeriod === 'all') {
    // All months since first order
    const firstOrder = await Order.findOne({ paymentStatus: 'Paid' }).sort({ createdAt: 1 });
    rangeStart = firstOrder ? new Date(firstOrder.createdAt.getFullYear(), firstOrder.createdAt.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    rangeEnd = now;
    dateFormat = '%Y-%m';
    groupStage = {
      _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
      revenue: { $sum: '$finalTotal' }
    };
    // Generate all months between rangeStart and rangeEnd
    labelGenerator = () => {
      const labels = [];
      const date = new Date(rangeStart);
      while (date <= rangeEnd) {
        labels.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
        date.setMonth(date.getMonth() + 1);
      }
      return labels;
    };
  } else {
    return res.status(400).json({ message: 'Invalid timePeriod' });
  }
  const match = { paymentStatus: 'Paid', createdAt: { $gte: rangeStart, $lte: rangeEnd } };
  const chartData = await Order.aggregate([
    { $match: match },
    { $group: groupStage },
    { $sort: { _id: 1 } }
  ]);
  // Map chartData to a dictionary for fast lookup
  const dataMap = Object.fromEntries(chartData.map(d => [d._id, d.revenue]));
  // Generate all labels and fill 0 for missing
  const labels = labelGenerator();
  const data = labels.map(label => dataMap[label] || 0);
  res.json({ labels, data });

  // Helper for week number (ISO week)
  function getWeekNumber(date) {
    const temp = new Date(date.getTime());
    temp.setHours(0, 0, 0, 0);
    temp.setDate(temp.getDate() + 4 - (temp.getDay() || 7));
    const yearStart = new Date(temp.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
    return String(weekNo).padStart(2, '0');
  }
}));
// Get all users (seller only)
router.get('/users', authSeller, async (req, res) => {
    try {
        const users = await User.find({}, 'name email phone status createdAt').sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error fetching users' });
    }
});
// Search users (seller only)
router.get('/users/search', authSeller, async (req, res) => {
    try {
        const { query } = req.query;
        const users = await User.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { phone: { $regex: query, $options: 'i' } }
            ]
        }, 'name email phone status createdAt');
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error searching users' });
    }
});

// Delete user (seller only)
router.delete('/users/:id', authSeller, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error deleting user' });
    }
});

// Block/Unblock user (seller only)
router.patch('/users/:id/status', authSeller, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'blocked'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, fields: 'name email phone status createdAt' }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: `User ${status === 'blocked' ? 'blocked' : 'unblocked'} successfully`, user });
    } catch (error) {
        res.status(500).json({ error: 'Server error updating user status' });
    }
});


module.exports = router;
