// Order routes module

const express = require("express");
const { validationResult, body, param } = require('express-validator');
const { authLimiter, apiLimiter, otpLimiter, paymentLimiter } = require('../middleware/rateLimiter');
const { asyncHandler, handleValidationErrors } = require('../middleware/errorHandler');
const { auditLogger } = require('../middleware/auditLogger');
const {
    validateProductId,
    validateEmail,
    validateAddress,
    validateOrderCreation,
    validateTrackOrder
} = require('../middleware/validators');
const router = express.Router();
const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const authMiddleware = require('../middleware/authMiddleware');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const notificationService = require('../services/notificationService');
const phonePeService = require('../services/phonePeService'); // adjust path if different

// Initialize Razorpay with error handling
let razorpay;
try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials not found in environment variables');
    }
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    // Razorpay initialized successfully
} catch (error) {
    console.error('❌ Failed to initialize Razorpay:', error.message);
    process.exit(1);
}

// ✅ Create Order API Route
router.post("/create-order", paymentLimiter, validateOrderCreation, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }

    // ✅ Check for idempotency key
    const baseIdempotencyKey = req.headers['x-idempotency-key'];
    if (!baseIdempotencyKey) {
        return res.status(400).json({ message: "Idempotency key is required to prevent duplicate orders." });
    }
    
    // ✅ Create payment gateway-specific idempotency key
    const { paymentMethod } = req.body;
    const idempotencyKey = `${paymentMethod}_${baseIdempotencyKey}`;
    // Using idempotency key for payment method
    
    // ✅ Cancel any existing pending orders with different payment methods for the same base key
    try {
        const pendingOrders = await Order.find({
            idempotencyKey: { $regex: `^(phonepe|razorpay)_${baseIdempotencyKey}$` },
            paymentStatus: "Pending",
            orderStatus: "Pending"
        });
        
        if (pendingOrders.length > 0) {
            // Found pending orders with same base key, cancelling them
            
            for (const pendingOrder of pendingOrders) {
                // Restore stock for cancelled orders
                await restoreStock(pendingOrder.orderItems);
                
                // Mark as cancelled
                await Order.findByIdAndUpdate(pendingOrder._id, {
                    orderStatus: "Canceled",
                    paymentStatus: "Failed"
                });
                
                // Cancelled pending order
            }
        }
    } catch (cleanupError) {
        // Error cleaning up pending orders - continue with request
        // Don't fail the request if cleanup fails
    }

    // ✅ Check if this idempotency key was already used
    const existingOrder = await Order.findOne({ idempotencyKey });
    if (existingOrder) {
        // Extract userId from request body for logging
        const { userId: requestUserId } = req.body;
        
        // ✅ Log duplicate order attempt
        auditLogger.warn('DUPLICATE_ORDER_ATTEMPT', {
            ip: req.ip,
            userId: requestUserId || 'guest',
            orderId: existingOrder.orderId,
            idempotencyKey: idempotencyKey,
            existingStatus: existingOrder.orderStatus
        });
        
        return res.status(409).json({ 
            message: "Order already exists with this idempotency key.",
            orderId: existingOrder.orderId,
            status: existingOrder.orderStatus
        });
    }

    let session = await mongoose.startSession();

    try {
        session.startTransaction();

        // Extract necessary data from request
        const {
            cartItems,
            shippingAddress,
            paymentMethod,
            userInfo,
            userId,
            totalPrice,
            discountAmount,
            shippingCharges,
            appliedCoupons,
        } = req.body;

        // Validate input
        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ message: "Cart is empty." });
        }
        if (!shippingAddress || !paymentMethod) {
            return res.status(422).json({ message: "Shipping address and payment method are required." });
        }

        // ✅ Calculate final total and generate order ID
        const finalTotal = totalPrice - discountAmount + shippingCharges;
        const userFriendlyOrderId = await generateOrderId();

        // ✅ Log order creation attempt AFTER variables are defined
        auditLogger.info('ORDER_CREATION_STARTED', {
            ip: req.ip,
            userId: userId || 'guest',
            orderId: userFriendlyOrderId,
            idempotencyKey: idempotencyKey,
            paymentMethod: paymentMethod,
            totalAmount: finalTotal,
            itemCount: cartItems.length
        });

        // ✅ Fetch user details if registered
        let userDetails = null;
        if (userId) {
            const user = await User.findById(userId).select("name email phone");
            if (user) {
                userDetails = { name: user.name, email: user.email, phone: user.phone };
            }
        }

        // ✅ Prepare orderItems and validate stock (but don't deduct yet for Razorpay)
        const orderItems = [];
        for (let item of cartItems) {
            const product = await Product.findById(item.productId).session(session);
            if (!product) {
                await session.abortTransaction();
                return res.status(404).json({ message: `Product with ID ${item.productId} not found.` });
            }

            if (product.stock < item.quantity) {
                await session.abortTransaction();
                return res.status(400).json({ message: `Insufficient stock for ${product.name}.` });
            }

          // ✅ Reserve stock for payment gateways that confirm later
if (paymentMethod === "razorpay" || paymentMethod === "phonepe") {
    // Just validate stock, don't deduct yet
    orderItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        subtotal: product.price * item.quantity,
    });
} else {
    // For others (e.g., COD), deduct immediately
    product.stock -= item.quantity;
    await product.save({ session });
    orderItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        subtotal: product.price * item.quantity,
    });
}

        }

        // ✅ For Razorpay: Only create Razorpay order, don't save to DB yet
        if (paymentMethod === "razorpay") {
            const razorpayOrder = await razorpay.orders.create({
                amount: Math.round(finalTotal * 100), // amount in paise
                currency: "INR",
                receipt: userFriendlyOrderId,
                notes: {
                    orderId: userFriendlyOrderId,
                    idempotencyKey: idempotencyKey,
                    baseIdempotencyKey: baseIdempotencyKey
                }
            });

            await session.commitTransaction();
            session.endSession();

            // ✅ Store order data temporarily for payment verification
            const tempOrderData = {
                cartItems,
                shippingAddress,
                paymentMethod,
                userInfo,
                userId,
                totalPrice,
                discountAmount,
                shippingCharges,
                finalTotal,
                appliedCoupons,
                userDetails,
                orderItems,
                orderId: userFriendlyOrderId,
                idempotencyKey: idempotencyKey
            };

            // ✅ Log Razorpay order creation
            auditLogger.payment('RAZORPAY_ORDER_CREATED', {
                ip: req.ip,
                userId: userId || 'guest',
                orderId: userFriendlyOrderId,
                razorpayOrderId: razorpayOrder.id,
                amount: razorpayOrder.amount,
                idempotencyKey: idempotencyKey
            });

            // Send response to frontend to open Razorpay checkout
            return res.status(200).json({
                success: true,
                razorpayOrderId: razorpayOrder.id,
                razorpayKey: process.env.RAZORPAY_KEY_ID,
                amount: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                orderId: userFriendlyOrderId,
                // Send order data for payment verification
                orderData: tempOrderData
            });
        }
        // --- PhonePe payment creation ---
                if (paymentMethod === "phonepe") {
                    // ✅ STRONG idempotency check - prevent ANY duplicate processing
                    const existingOrder = await Order.findOne({ 
                        $or: [
                            { orderId: userFriendlyOrderId },
                            { idempotencyKey: idempotencyKey }
                        ]
                    });
                    
                    if (existingOrder) {
                        console.log(`⚠️ DUPLICATE BLOCKED: Order ${userFriendlyOrderId} already exists`);
                        await session.abortTransaction();
                        session.endSession();
                        
                        // Return existing order's payment URL if available
                        const paymentUrl = existingOrder.transactionId 
                            ? `#existing-${existingOrder.orderId}` 
                            : null;
                            
                        return res.status(200).json({
                            success: true,
                            message: 'Order already processed',
                            orderId: existingOrder.orderId,
                            phonePeTransactionId: existingOrder.transactionId,
                            paymentUrl: paymentUrl,
                            amount: Math.round(existingOrder.finalTotal * 100),
                            orderData: null, // Don't return order data for existing orders
                            redirectUrl: paymentUrl
                        });
                    }
                    
                    let phonePeResult;
                    let orderCreated = false;
                    let dbRetries = 0;
                    const MAX_DB_RETRIES = 3;
                    
                    // ✅ Build order data outside the retry loop to avoid scope issues
                    const tempOrderData = {
                        cartItems,
                        shippingAddress,
                        paymentMethod,
                        userInfo,
                        userId,
                        totalPrice,
                        discountAmount,
                        shippingCharges,
                        finalTotal,
                        appliedCoupons,
                        userDetails,
                        orderItems,
                        orderId: userFriendlyOrderId,
                        idempotencyKey: idempotencyKey
                    };
                    
                    try {
                        // ✅ Call PhonePe service FIRST with timeout handling
                        phonePeResult = await Promise.race([
                            phonePeService.createPaymentOrder(tempOrderData),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('PhonePe_TIMEOUT')), 15000) // 15 second timeout
                            )
                        ]);
                        console.log("✅ PhonePe API call successful, now saving order...");
                        
                        // ✅ Create order record with PENDING status
                        const orderData = {
                            userId,
                            orderId: userFriendlyOrderId,
                            orderItems,
                            shippingAddress,
                            paymentMethod,
                            totalPrice,
                            discountAmount,
                            shippingCharges,
                            finalTotal,
                            appliedCoupons,
                            orderStatus: "Pending",
                            paymentStatus: "Pending",
                            transactionId: phonePeResult.orderId,
                            merchantTransactionId: phonePeResult.merchantOrderId,
                            orderDate: new Date(),
                            isRegisteredUser: !!userId,
                            trackingId: null,
                            courierPartner: null,
                            idempotencyKey: idempotencyKey
                        };

                        // ✅ Attach User or Guest Info
                        if (userId && userDetails) {
                            orderData.userName = userDetails.name;
                            orderData.userEmail = userDetails.email;
                            orderData.userPhone = userDetails.phone;
                        } else if (userInfo) {
                            orderData.guestName = userInfo.name;
                            orderData.guestEmail = userInfo.email;
                            orderData.guestPhone = userInfo.phone;
                        }

                        // ✅ Deduct stock AFTER PhonePe success
                        for (let item of orderItems) {
                            const product = await Product.findById(item.productId).session(session);
                            if (product) {
                                product.stock -= item.quantity;
                                await product.save({ session });
                                console.log(`✅ Stock deducted for PhonePe order: ${item.name} - ${item.quantity} units`);
                            }
                        }

                        // ✅ Save order to database - NO RETRIES
                        const order = new Order(orderData);
                        await order.save({ session });
                        
                        // ✅ Commit transaction
                        await session.commitTransaction();
                        session.endSession();
                    
                    // ✅ Log successful creation
                    auditLogger.payment("PHONEPE_ORDER_CREATED", {
                        ip: req.ip,
                        userId: userId || "guest",
                        orderId: userFriendlyOrderId,
                        phonePeTransactionId: phonePeResult.orderId,
                        paymentUrl: phonePeResult.paymentUrl,
                        amount: finalTotal,
                        idempotencyKey: idempotencyKey
                    });
                    
                    console.log("✅ PhonePe payment order created:", {
                        orderId: userFriendlyOrderId,
                        transactionId: phonePeResult.orderId,
                        paymentUrl: phonePeResult.paymentUrl
                    });

                    // 🔔 Send multi-channel notifications for new PhonePe order
                    try {
                        // Get the first available seller's email from database
                        const Seller = require('../seller-backend/models/sellerModel');
                        const seller = await Seller.findOne().select('email _id');
                        
                        if (seller) {
                            const phonePeNotificationData = {
                                orderId: userFriendlyOrderId,
                                amount: finalTotal.toFixed(2),
                                customerName: userDetails ? userDetails.name : (userInfo ? userInfo.name : 'Guest Customer'),
                                products: orderItems.map(item => item.name)
                            };
                            
                            // Send notifications via email and push channels (no Socket.IO)
                            const notificationService = require('../services/notificationService');
                            await notificationService.sendMultiChannelNotification(
                                seller._id.toString(),
                                notificationService.createOrderNotification(phonePeNotificationData),
                                seller.email
                            );
                            
                            console.log(`🔔 PhonePe order notifications sent to seller ${seller.email} for order ${userFriendlyOrderId}`);
                        } else {
                            console.warn('⚠️ No seller found in database for PhonePe notifications');
                        }
                    } catch (notificationError) {
                        console.error('❌ Failed to send PhonePe order notifications:', notificationError);
                        // Don't fail the order creation if notifications fail
                    }

                    // ✅ Return data to frontend
                    return res.status(200).json({
                        success: true,
                        phonePeTransactionId: phonePeResult.orderId,
                        paymentUrl: phonePeResult.paymentUrl,
                        orderId: userFriendlyOrderId,
                        amount: Math.round(finalTotal * 100),
                        orderData: tempOrderData,
                        redirectUrl: phonePeResult.paymentUrl
                    });
                
                } catch (error) {
                      console.error("❌ PhonePe create order error:", error);
                      
                      auditLogger.error('PHONEPE_ORDER_CREATION_FAILED', {
                        ip: req.ip,
                        userId: userId || 'guest',
                        orderId: userFriendlyOrderId,
                        error: error.message,
                        idempotencyKey: idempotencyKey
                      });
                      
                      if (session.inTransaction()) await session.abortTransaction();
                      session.endSession();
                      
                      // ✅ Special handling for PhonePe timeout - create cancelled order and redirect
                      if (error.message === 'PhonePe_TIMEOUT') {
                        try {
                          console.log('📋 PhonePe timed out, creating cancelled order for tracking...');
                          
                          // Create a cancelled order record for tracking
                          const cancelledOrderData = {
                            userId,
                            orderId: userFriendlyOrderId,
                            orderItems,
                            shippingAddress,
                            paymentMethod: 'phonepe',
                            totalPrice,
                            discountAmount,
                            shippingCharges,
                            finalTotal,
                            appliedCoupons,
                            orderStatus: "Canceled",
                            paymentStatus: "Failed",
                            transactionId: null,
                            orderDate: new Date(),
                            isRegisteredUser: !!userId,
                            idempotencyKey: idempotencyKey
                          };
                          
                          // Attach user info
                          if (userId && userDetails) {
                            cancelledOrderData.userName = userDetails.name;
                            cancelledOrderData.userEmail = userDetails.email;
                            cancelledOrderData.userPhone = userDetails.phone;
                          } else if (userInfo) {
                            cancelledOrderData.guestName = userInfo.name;
                            cancelledOrderData.guestEmail = userInfo.email;
                            cancelledOrderData.guestPhone = userInfo.phone;
                          }
                          
                          const cancelledOrder = new Order(cancelledOrderData);
                          await cancelledOrder.save();
                          
                          console.log(`📋 Created cancelled order ${userFriendlyOrderId} due to PhonePe timeout`);
                          
                          // Return response that will redirect to order confirmation with error
                          return res.status(200).json({
                            success: false,
                            phonepeTimeout: true,
                            orderId: userFriendlyOrderId,
                            message: 'PhonePe payment timed out. Order has been cancelled.',
                            redirectTo: `/store/order-confirmation.html?error=phonepe_timeout&orderId=${userFriendlyOrderId}`
                          });
                        } catch (cancelledOrderError) {
                          console.error('❌ Failed to create cancelled order:', cancelledOrderError);
                        }
                      }
                      
                      // Provide user-friendly error message for other errors
                      let userMessage = "Unable to create PhonePe payment. Please try again.";
                      if (error.message.includes('timeout') || error.message === 'PhonePe_TIMEOUT') {
                        userMessage = "PhonePe service timeout. Please try again with a different payment method.";
                      } else if (error.message.includes('network') || error.message.includes('connect')) {
                        userMessage = "Network connection issue. Please check your internet and try again.";
                      } else if (error.message.includes('duplicate') || error.code === 11000) {
                        userMessage = "Order already exists. Please refresh and check your orders.";
                      }
                      
                      return res.status(500).json({
                        success: false,
                        message: userMessage,
                        errorType: 'phonepe_error',
                        canRetry: !error.message.includes('duplicate')
                      });
                    }
                  }
                  


        // ✅ For non-Razorpay payment methods, create order immediately
        const orderData = {
            userId,
            orderId: userFriendlyOrderId,
            orderItems,
            shippingAddress,
            paymentMethod,
            totalPrice,
            discountAmount,
            shippingCharges,
            finalTotal,
            appliedCoupons,
            orderStatus: "Pending",
            paymentStatus: "Pending",
            orderDate: new Date(),
            isRegisteredUser: !!userId,
            trackingId: null,
            courierPartner: null,
            idempotencyKey: idempotencyKey
        };

        // ✅ Attach User or Guest Info
        if (userId && userDetails) {
            orderData.userName = userDetails.name;
            orderData.userEmail = userDetails.email;
            orderData.userPhone = userDetails.phone;
        } else if (userInfo) {
            orderData.guestName = userInfo.name;
            orderData.guestEmail = userInfo.email;
            orderData.guestPhone = userInfo.phone;
        }

        // ✅ Save Order
        const order = new Order(orderData);
        await order.save({ session });

        await session.commitTransaction();
        session.endSession();

        // ✅ Log successful order creation
        auditLogger.info('ORDER_CREATED_SUCCESSFULLY', {
            ip: req.ip,
            userId: userId || 'guest',
            orderId: userFriendlyOrderId,
            paymentMethod: paymentMethod,
            totalAmount: finalTotal,
            itemCount: orderItems.length,
            idempotencyKey: idempotencyKey
        });

        // 🔔 Send multi-channel notifications for new order
        try {
            // Get the first available seller's email from database
            const Seller = require('../seller-backend/models/sellerModel');
            const seller = await Seller.findOne().select('email _id');
            
            if (seller) {
                const orderNotificationData = {
                    orderId: userFriendlyOrderId,
                    amount: finalTotal.toFixed(2),
                    customerName: userDetails ? userDetails.name : (userInfo ? userInfo.name : 'Guest Customer'),
                    products: orderItems.map(item => item.name)
                };
                
                // Send notifications via email and push channels (no Socket.IO)
                await notificationService.sendMultiChannelNotification(
                    seller._id.toString(), // Use actual seller ID
                    notificationService.createOrderNotification(orderNotificationData),
                    seller.email // Use actual seller's email
                );
                
                // Notification sent successfully
            } else {
                console.warn('No seller found in database for notifications');
            }
        } catch (notificationError) {
            console.error('Failed to send order notifications:', notificationError.message);
            // Don't fail the order creation if notifications fail
        }

        // ✅ Return order ID to frontend
        return res.status(201).json({
            message: "Order created successfully",
            orderId: userFriendlyOrderId,
        });

    } catch (error) {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
        throw error; // Let error handler middleware handle it
    }
}));

// ✅ Restore Stock Function
async function restoreStock(orderItems) {
  for (let item of orderItems) {
    const product = await Product.findById(item.productId);
    if (product) {
      product.stock += item.quantity;
      await product.save();
      console.log(`🔄 Stock restored for ${item.name}: +${item.quantity} units (new stock: ${product.stock})`);
    }
  }
}

// ✅ Debug endpoint to check pending orders
router.get('/debug/pending-orders', asyncHandler(async (req, res) => {
    try {
        const pendingOrders = await Order.find({
            paymentStatus: "Pending",
            orderStatus: { $in: ["Pending", "Processing"] }
        }).select('orderId paymentMethod paymentStatus orderStatus createdAt idempotencyKey transactionId').sort({ createdAt: -1 }).limit(20);
        
        const summary = {
            totalPending: pendingOrders.length,
            phonepe: pendingOrders.filter(o => o.paymentMethod === 'phonepe').length,
            razorpay: pendingOrders.filter(o => o.paymentMethod === 'razorpay').length,
            orders: pendingOrders.map(order => ({
                orderId: order.orderId,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                orderStatus: order.orderStatus,
                createdAt: order.createdAt,
                idempotencyKey: order.idempotencyKey,
                hasTransactionId: !!order.transactionId,
                ageInMinutes: Math.round((Date.now() - order.createdAt.getTime()) / (1000 * 60))
            }))
        };
        
        res.status(200).json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}));

// ✅ Manual cleanup endpoint for stuck orders
router.post('/debug/cleanup-pending/:baseIdempotencyKey', asyncHandler(async (req, res) => {
    try {
        const { baseIdempotencyKey } = req.params;
        
        const pendingOrders = await Order.find({
            idempotencyKey: { $regex: `^(phonepe|razorpay)_${baseIdempotencyKey}$` },
            paymentStatus: "Pending"
        });
        
        let cleaned = 0;
        for (const order of pendingOrders) {
            await restoreStock(order.orderItems);
            await Order.findByIdAndUpdate(order._id, {
                orderStatus: "Canceled",
                paymentStatus: "Failed"
            });
            cleaned++;
        }
        
        res.status(200).json({ 
            message: `Cleaned up ${cleaned} pending orders for base key: ${baseIdempotencyKey}`,
            cleanedOrders: pendingOrders.map(o => o.orderId)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}));

// ✅ Auto-Cancel Service Management Routes
const autoCancelService = require('../services/autoCancelService');

// Get auto-cancel service status
router.get('/debug/auto-cancel/status', asyncHandler(async (req, res) => {
    try {
        const status = autoCancelService.getStatus();
        res.status(200).json({
            success: true,
            ...status,
            message: status.isRunning ? 'Auto-cancel service is running' : 'Auto-cancel service is stopped'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}));

// Start auto-cancel service
router.post('/debug/auto-cancel/start', asyncHandler(async (req, res) => {
    try {
        autoCancelService.start();
        res.status(200).json({ 
            success: true, 
            message: 'Auto-cancel service started',
            status: autoCancelService.getStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}));

// Stop auto-cancel service
router.post('/debug/auto-cancel/stop', asyncHandler(async (req, res) => {
    try {
        autoCancelService.stop();
        res.status(200).json({ 
            success: true, 
            message: 'Auto-cancel service stopped',
            status: autoCancelService.getStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}));

// Force run auto-cancel check
router.post('/debug/auto-cancel/force-check', asyncHandler(async (req, res) => {
    try {
        await autoCancelService.forceCheck();
        res.status(200).json({ 
            success: true, 
            message: 'Auto-cancel check completed',
            status: autoCancelService.getStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}));

// Update auto-cancel service configuration
router.put('/debug/auto-cancel/config', asyncHandler(async (req, res) => {
    try {
        const { checkInterval, timeoutMinutes } = req.body;
        
        // Validate inputs
        if (checkInterval && (checkInterval < 60000 || checkInterval > 3600000)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Check interval must be between 1 minute and 1 hour' 
            });
        }
        
        if (timeoutMinutes && (timeoutMinutes < 5 || timeoutMinutes > 120)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Timeout must be between 5 minutes and 2 hours' 
            });
        }
        
        autoCancelService.updateConfig({ checkInterval, timeoutMinutes });
        
        res.status(200).json({ 
            success: true, 
            message: 'Auto-cancel service configuration updated',
            status: autoCancelService.getStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}));

// ✅ Order ID Generator
async function generateOrderId() {
  try {
    const lastOrder = await Order.findOne({}, {}, { sort: { createdAt: -1 } });
    let lastOrderNumber = lastOrder ? parseInt(lastOrder.orderId.split("-").pop()) : 0;
    lastOrderNumber += 1;
    const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
    return `ORD-${timestamp}-${lastOrderNumber}`;
  } catch (error) {
    console.error("Error generating order ID:", error);
    return `ORD-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-1`;
  }
}

router.post('/track-order', apiLimiter, validateTrackOrder, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
    try {
        const { email, phone, orderId } = req.body;

        if (!email || !phone) {
            return res.status(400).json({ message: 'Email and phone are required.' });
        }

        const query = {
            $or: [
                { guestEmail: email, guestPhone: phone },
                { userEmail: email, userPhone: phone }
            ]
        };

        if (orderId) {
            query.$or.push({ orderId });
            query.$or.push({ _id: orderId });
        }

        const orders = await Order.find(query).lean();

        if (!orders || orders.length === 0) {
            return res.status(404).json({ message: 'No orders found for the given details.' });
        }

        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            trackingId: order.trackingId || "N/A",
            courierPartner: order.courierPartner || "N/A",
            name: order.isRegisteredUser ? order.userName : order.guestName,
            email: order.isRegisteredUser ? order.userEmail : order.guestEmail,
            phone: order.isRegisteredUser ? order.userPhone : order.guestPhone,
            orderStatus: order.orderStatus,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            totalPrice: order.totalPrice,
            finalTotal: order.finalTotal,                      // ✅ Added
            shippingCharges: order.shippingCharges,            // ✅ Added
            appliedCoupons: order.appliedCoupons || [],        // ✅ Added
            orderDate: order.createdAt,
            shippingAddress: order.shippingAddress,
            orderItems: order.orderItems.map(item => ({
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                subtotal: item.subtotal
            }))
        }));

        res.status(200).json({ orders: formattedOrders });
    } catch (error) {
        throw error;
    }
}));

router.get('/my-orders', authMiddleware, asyncHandler(async (req, res) => {
    try {
        console.log("Entering /my-orders route...");

        const userId = req.user.userId;
        console.log("User ID from middleware:", userId);

        const orders = await Order.find({ userId })
            .lean()
            .populate("orderItems.productId", "image")
            .sort({ createdAt: -1 });

        if (!orders || orders.length === 0) {
            console.log("No orders found for this user.");
            return res.status(404).json({ message: 'No orders found for this user.' });
        }

        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            trackingId: order.trackingId || "N/A",
            courierPartner: order.courierPartner || "N/A",
            name: order.userName,
            email: order.userEmail,
            phone: order.userPhone,
            orderStatus: order.orderStatus,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            totalPrice: order.totalPrice,
            finalTotal: order.finalTotal,                      // ✅ Added
            shippingCharges: order.shippingCharges,            // ✅ Added
            appliedCoupons: order.appliedCoupons || [],        // ✅ Added
            orderDate: order.createdAt,
            shippingAddress: order.shippingAddress,
            orderItems: order.orderItems.map(item => ({
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                subtotal: item.subtotal,
                image: item.productId?.image || 'fallback.jpg'
            }))
        }));

        console.log("Formatted Orders:", formattedOrders);

        res.status(200).json({ orders: formattedOrders });
    } catch (error) {
        throw error;
    }
}));

// Fetch Product Details Route
router.get('/products/:productId', validateProductId, asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json(handleValidationErrors(errors));
    }
    try {
        const { productId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: 'Invalid product ID.' });
        }

        const product = await Product.findById(productId).lean();
        if (!product) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        res.status(200).json({
            name: product.name,
            price: product.price,
            image: product.image,
            description: product.description || "No description available."
        });
    } catch (error) {
        throw error;
    }
}));


router.post("/verify-payment", paymentLimiter, asyncHandler(async (req, res) => {
    const { 
        razorpay_order_id, 
        razorpay_payment_id, 
        razorpay_signature, 
        orderId,
        orderData // This will contain the temporary order data from frontend
    } = req.body;

    // ✅ Log payment verification attempt
    auditLogger.payment('PAYMENT_VERIFICATION_STARTED', {
        ip: req.ip,
        userId: req.body.userId || 'guest',
        orderId: orderId,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        timestamp: new Date().toISOString()
    });

    // ✅ Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId || !orderData) {
        auditLogger.error('PAYMENT_VERIFICATION_FAILED', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            reason: 'Missing required fields',
            missingFields: {
                razorpay_order_id: !razorpay_order_id,
                razorpay_payment_id: !razorpay_payment_id,
                razorpay_signature: !razorpay_signature,
                orderId: !orderId,
                orderData: !orderData
            }
        });
        
        return res.status(400).json({ 
            success: false, 
            message: "Missing required payment verification data" 
        });
    }

    // ✅ Verify Razorpay signature
    const generated_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest('hex');

    if (generated_signature !== razorpay_signature) {
        auditLogger.security('PAYMENT_SIGNATURE_VERIFICATION_FAILED', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            expectedSignature: generated_signature,
            receivedSignature: razorpay_signature,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id
        });
        
        console.error(`❌ Payment signature verification failed for order ${orderId}`);
        console.error(`Expected: ${generated_signature}, Received: ${razorpay_signature}`);
        return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    // ✅ Check if order already exists (idempotency)
    const existingOrder = await Order.findOne({ orderId: orderId });
    if (existingOrder) {
        auditLogger.info('PAYMENT_VERIFICATION_DUPLICATE', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            existingOrderId: existingOrder._id,
            existingStatus: existingOrder.orderStatus,
            existingPaymentStatus: existingOrder.paymentStatus
        });
        
        console.log(`✅ Order ${orderId} already exists, returning existing order`);
        return res.json({ 
            success: true, 
            message: "Order already exists", 
            orderId: orderId,
            existing: true
        });
    }

    // ✅ Now create the actual order in database after successful payment
    const session = await mongoose.startSession();
    
    try {
        session.startTransaction();

        // ✅ Verify Razorpay order status
        try {
            const razorpayOrder = await razorpay.orders.fetch(razorpay_order_id);
            if (razorpayOrder.status !== 'paid') {
                throw new Error(`Razorpay order status is ${razorpayOrder.status}, expected 'paid'`);
            }
        } catch (razorpayError) {
            console.error(`❌ Razorpay order verification failed:`, razorpayError);
            await session.abortTransaction();
            return res.status(400).json({ 
                success: false, 
                message: "Razorpay order verification failed" 
            });
        }

        // ✅ Deduct stock now that payment is confirmed
        for (let item of orderData.orderItems) {
            const product = await Product.findById(item.productId).session(session);
            if (!product) {
                await session.abortTransaction();
                console.error(`❌ Product ${item.name} not found during payment verification`);
                return res.status(404).json({ 
                    success: false, 
                    message: `Product ${item.name} not found` 
                });
            }

            if (product.stock < item.quantity) {
                await session.abortTransaction();
                console.error(`❌ Insufficient stock for ${item.name} during payment verification`);
                return res.status(400).json({ 
                    success: false, 
                    message: `Insufficient stock for ${item.name}` 
                });
            }

            // ✅ Deduct stock
            product.stock -= item.quantity;
            await product.save({ session });
            console.log(`✅ Stock deducted for ${item.name}: ${item.quantity} units`);
        }

        // ✅ Create the database order
        const dbOrderData = {
            userId: orderData.userId,
            orderId: orderData.orderId,
            orderItems: orderData.orderItems,
            shippingAddress: orderData.shippingAddress,
            paymentMethod: orderData.paymentMethod,
            totalPrice: orderData.totalPrice,
            discountAmount: orderData.discountAmount,
            shippingCharges: orderData.shippingCharges,
            finalTotal: orderData.finalTotal,
            appliedCoupons: orderData.appliedCoupons || [],
            orderStatus: "Processing",
            paymentStatus: "Paid",
            transactionId: razorpay_payment_id,
            orderDate: new Date(),
            isRegisteredUser: !!orderData.userId,
            trackingId: null,
            courierPartner: null,
            idempotencyKey: orderData.idempotencyKey
        };

        // ✅ Attach User or Guest Info
        if (orderData.userId && orderData.userDetails) {
            dbOrderData.userName = orderData.userDetails.name;
            dbOrderData.userEmail = orderData.userDetails.email;
            dbOrderData.userPhone = orderData.userDetails.phone;
        } else if (orderData.userInfo) {
            dbOrderData.guestName = orderData.userInfo.name;
            dbOrderData.guestEmail = orderData.userInfo.email;
            dbOrderData.guestPhone = orderData.userInfo.phone;
        }

        // ✅ Save the order
        const order = new Order(dbOrderData);
        await order.save({ session });

        await session.commitTransaction();
        session.endSession();

        // ✅ Generate and send invoice automatically after payment confirmation
        try {
            const invoiceService = require('../services/invoiceService');
            const invoiceBuffer = await invoiceService.generateInvoice(order);
            const filename = invoiceService.generateFilename(order.orderId);
            
            auditLogger.info('INVOICE_AUTO_GENERATED', {
                ip: req.ip,
                userId: orderData.userId || 'guest',
                orderId: orderData.orderId,
                filename: filename,
                timestamp: new Date().toISOString()
            });
            
            console.log(`📄 Invoice generated automatically for order ${orderData.orderId}`);
        } catch (invoiceError) {
            console.error(`❌ Failed to generate invoice for order ${orderData.orderId}:`, invoiceError);
            auditLogger.error('INVOICE_AUTO_GENERATION_FAILED', {
                ip: req.ip,
                userId: orderData.userId || 'guest',
                orderId: orderData.orderId,
                error: invoiceError.message,
                timestamp: new Date().toISOString()
            });
        }

        // ✅ Log successful payment verification and order creation
        auditLogger.payment('PAYMENT_VERIFICATION_SUCCESSFUL', {
            ip: req.ip,
            userId: orderData.userId || 'guest',
            orderId: orderData.orderId,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            transactionId: razorpay_payment_id,
            amount: orderData.finalTotal,
            itemCount: orderData.orderItems.length,
            idempotencyKey: orderData.idempotencyKey
        });

        console.log(`✅ Payment verified and order ${orderData.orderId} created successfully`);
        console.log(`💰 Transaction ID: ${razorpay_payment_id}`);
        console.log(`📦 Order Status: ${dbOrderData.orderStatus}`);

        // 📧 Send customer confirmation email (same as PhonePe)
        try {
            const emailService = require('../services/emailService');
            
            // Get customer email from different possible sources
            const customerEmail = orderData.userDetails?.email || 
                                orderData.userInfo?.email || 
                                dbOrderData.userEmail || 
                                dbOrderData.guestEmail;
            
            if (customerEmail) {
                const emailOrderData = {
                    orderId: orderData.orderId,
                    totalAmount: orderData.finalTotal,
                    items: orderData.orderItems.map(item => ({
                        name: item.name,
                        quantity: item.quantity,
                        price: item.price,
                        image: item.image || '/placeholder.jpg'
                    })),
                    shippingAddress: `${orderData.shippingAddress.street}, ${orderData.shippingAddress.city}, ${orderData.shippingAddress.state}, ${orderData.shippingAddress.zipcode}`,
                    expectedDelivery: '2-4 business days'
                };
                
                await emailService.sendCheckoutSuccessEmail(customerEmail, emailOrderData);
                console.log(`📧 Razorpay checkout success email sent to ${customerEmail}`);
            } else {
                console.warn('⚠️ No customer email found for Razorpay checkout success email');
            }
        } catch (emailError) {
            console.error('❌ Failed to send Razorpay checkout success email:', emailError);
            // Don't fail the order creation if email fails
        }

        // 🔔 Send multi-channel notifications for paid Razorpay order
        try {
            // Get the first available seller's email from database
            const Seller = require('../seller-backend/models/sellerModel');
            const seller = await Seller.findOne().select('email _id');
            
            if (seller) {
                const razorpayNotificationData = {
                    orderId: orderData.orderId,
                    amount: orderData.finalTotal.toFixed(2),
                    customerName: orderData.userDetails ? orderData.userDetails.name : (orderData.userInfo ? orderData.userInfo.name : 'Guest Customer'),
                    products: orderData.orderItems.map(item => item.name)
                };
                
                // Send notifications via email and push channels (no Socket.IO)
                await notificationService.sendMultiChannelNotification(
                    seller._id.toString(), // Use actual seller ID
                    notificationService.createOrderNotification(razorpayNotificationData),
                    seller.email // Use actual seller's email
                );
                
                console.log(`🔔 Razorpay order notifications sent to seller ${seller.email} for order ${orderData.orderId}`);
            } else {
                console.warn('⚠️ No seller found in database for Razorpay notifications');
            }
        } catch (notificationError) {
            console.error('❌ Failed to send Razorpay order notifications:', notificationError);
            // Don't fail the order creation if notifications fail
        }

        res.json({ 
            success: true, 
            message: "Payment verified and order created successfully", 
            orderId: orderData.orderId,
            transactionId: razorpay_payment_id
        });

    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
            console.error(`❌ Transaction aborted for order ${orderId}:`, error);
        }
        session.endSession();
        
        // ✅ Log payment verification failure
        auditLogger.error('PAYMENT_VERIFICATION_FAILED', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        // ✅ Log detailed error information
        console.error(`❌ Payment verification failed for order ${orderId}:`, {
            error: error.message,
            stack: error.stack,
            razorpay_order_id,
            razorpay_payment_id,
            timestamp: new Date().toISOString()
        });
        
        throw error;
    }
}));

// Verify PhonePe payment
router.post('/phonepe-verify', paymentLimiter, asyncHandler(async (req, res) => {
    const { 
        transactionId, 
        orderId,
        orderData // This will contain the temporary order data from frontend
    } = req.body;

    // ✅ Log PhonePe payment verification attempt
    auditLogger.payment('PHONEPE_VERIFICATION_STARTED', {
        ip: req.ip,
        userId: req.body.userId || 'guest',
        orderId: orderId,
        transactionId: transactionId,
        timestamp: new Date().toISOString()
    });

    if (!transactionId || !orderId || !orderData) {
        auditLogger.error('PHONEPE_VERIFICATION_FAILED', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            reason: 'Missing required fields',
            missingFields: {
                transactionId: !transactionId,
                orderId: !orderId,
                orderData: !orderData
            }
        });
        
        return res.status(400).json({ 
            success: false, 
            message: "Missing required payment verification data" 
        });
    }

    // ✅ Check if order already exists (idempotency)
    const existingOrder = await Order.findOne({ orderId: orderId });
    if (existingOrder) {
        auditLogger.info('PHONEPE_VERIFICATION_DUPLICATE', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            existingOrderId: existingOrder._id,
            existingStatus: existingOrder.orderStatus,
            existingPaymentStatus: existingOrder.paymentStatus
        });
        
        console.log(`✅ Order ${orderId} already exists, returning existing order`);
        return res.json({ 
            success: true, 
            message: "Order already exists", 
            orderId: orderId,
            existing: true
        });
    }

    const session = await mongoose.startSession();
    
    try {
        session.startTransaction();

        // ✅ Check PhonePe payment status
        const status = await phonePeService.checkPaymentStatus(transactionId);

        if (!status || !status.success || status.status !== 'COMPLETED') {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: 'Payment not successful or still pending.',
                status: status?.status || 'UNKNOWN'
            });
        }

        // ✅ Deduct stock now that payment is confirmed
        for (let item of orderData.orderItems) {
            const product = await Product.findById(item.productId).session(session);
            if (!product) {
                await session.abortTransaction();
                console.error(`❌ Product ${item.name} not found during PhonePe payment verification`);
                return res.status(404).json({ 
                    success: false, 
                    message: `Product ${item.name} not found` 
                });
            }

            if (product.stock < item.quantity) {
                await session.abortTransaction();
                console.error(`❌ Insufficient stock for ${item.name} during PhonePe payment verification`);
                return res.status(400).json({ 
                    success: false, 
                    message: `Insufficient stock for ${item.name}` 
                });
            }

            // ✅ Deduct stock
            product.stock -= item.quantity;
            await product.save({ session });
            console.log(`✅ Stock deducted for ${item.name}: ${item.quantity} units`);
        }

        // ✅ Create the database order
        const dbOrderData = {
            userId: orderData.userId,
            orderId: orderData.orderId,
            orderItems: orderData.orderItems,
            shippingAddress: orderData.shippingAddress,
            paymentMethod: orderData.paymentMethod,
            totalPrice: orderData.totalPrice,
            discountAmount: orderData.discountAmount,
            shippingCharges: orderData.shippingCharges,
            finalTotal: orderData.finalTotal,
            appliedCoupons: orderData.appliedCoupons || [],
            orderStatus: "Processing",
            paymentStatus: "Paid",
            transactionId: transactionId,
            orderDate: new Date(),
            isRegisteredUser: !!orderData.userId,
            trackingId: null,
            courierPartner: null,
            idempotencyKey: orderData.idempotencyKey,
            phonePePaymentData: status
        };

        // ✅ Attach User or Guest Info
        if (orderData.userId && orderData.userDetails) {
            dbOrderData.userName = orderData.userDetails.name;
            dbOrderData.userEmail = orderData.userDetails.email;
            dbOrderData.userPhone = orderData.userDetails.phone;
        } else if (orderData.userInfo) {
            dbOrderData.guestName = orderData.userInfo.name;
            dbOrderData.guestEmail = orderData.userInfo.email;
            dbOrderData.guestPhone = orderData.userInfo.phone;
        }

        // ✅ Save the order
        const order = new Order(dbOrderData);
        await order.save({ session });

        await session.commitTransaction();
        session.endSession();

        // ✅ Generate and send invoice automatically after PhonePe payment confirmation
        try {
            const invoiceService = require('../services/invoiceService');
            const invoiceBuffer = await invoiceService.generateInvoice(order);
            const filename = invoiceService.generateFilename(order.orderId);
            
            auditLogger.info('PHONEPE_INVOICE_AUTO_GENERATED', {
                ip: req.ip,
                userId: orderData.userId || 'guest',
                orderId: orderData.orderId,
                filename: filename,
                timestamp: new Date().toISOString()
            });
            
            console.log(`📄 PhonePe invoice generated automatically for order ${orderData.orderId}`);
        } catch (invoiceError) {
            console.error(`❌ Failed to generate PhonePe invoice for order ${orderData.orderId}:`, invoiceError.message);
            auditLogger.error('PHONEPE_INVOICE_AUTO_GENERATION_FAILED', {
                ip: req.ip,
                userId: orderData.userId || 'guest',
                orderId: orderData.orderId,
                error: invoiceError.message,
                timestamp: new Date().toISOString()
            });
        }

        // ✅ Log successful PhonePe payment verification and order creation
        auditLogger.payment('PHONEPE_VERIFICATION_SUCCESSFUL', {
            ip: req.ip,
            userId: orderData.userId || 'guest',
            orderId: orderData.orderId,
            transactionId: transactionId,
            amount: orderData.finalTotal,
            itemCount: orderData.orderItems.length,
            idempotencyKey: orderData.idempotencyKey
        });

        console.log(`✅ PhonePe payment verified and order ${orderData.orderId} created successfully`);

        // 📧 Send customer confirmation email (same as Razorpay)
        try {
            const emailService = require('../services/emailService');
            
            // Get customer email from different possible sources
            const customerEmail = orderData.userDetails?.email || 
                                orderData.userInfo?.email || 
                                dbOrderData.userEmail || 
                                dbOrderData.guestEmail;
            
            if (customerEmail) {
                const emailOrderData = {
                    orderId: orderData.orderId,
                    totalAmount: orderData.finalTotal,
                    items: orderData.orderItems.map(item => ({
                        name: item.name,
                        quantity: item.quantity,
                        price: item.price,
                        image: item.image || '/placeholder.jpg'
                    })),
                    shippingAddress: `${orderData.shippingAddress.street}, ${orderData.shippingAddress.city}, ${orderData.shippingAddress.state}, ${orderData.shippingAddress.zipcode}`,
                    expectedDelivery: '2-4 business days'
                };
                
                await emailService.sendCheckoutSuccessEmail(customerEmail, emailOrderData);
                console.log(`📧 PhonePe checkout success email sent to ${customerEmail}`);
            } else {
                console.warn('⚠️ No customer email found for PhonePe checkout success email');
            }
        } catch (emailError) {
            console.error('❌ Failed to send PhonePe checkout success email:', emailError);
            // Don't fail the order creation if email fails
        }

        // 🔔 Send multi-channel notifications for paid PhonePe order
        try {
            const Seller = require('../seller-backend/models/sellerModel');
            const seller = await Seller.findOne().select('email _id');
            
            if (seller) {
                const phonePeNotificationData = {
                    orderId: orderData.orderId,
                    amount: orderData.finalTotal.toFixed(2),
                    customerName: orderData.userDetails ? orderData.userDetails.name : (orderData.userInfo ? orderData.userInfo.name : 'Guest Customer'),
                    products: orderData.orderItems.map(item => item.name)
                };
                
                // Send notifications via email and push channels (no Socket.IO)
                await notificationService.sendMultiChannelNotification(
                    seller._id.toString(),
                    notificationService.createOrderNotification(phonePeNotificationData),
                    seller.email
                );
                
                console.log(`🔔 PhonePe order notifications sent to seller for order ${orderData.orderId}`);
            } else {
                console.warn('⚠️ No seller found in database for PhonePe notifications');
            }
        } catch (notificationError) {
            console.error('❌ Failed to send PhonePe order notifications:', notificationError.message);
            // Don't fail the order creation if notifications fail
        }

        return res.status(200).json({
            success: true,
            message: 'PhonePe payment verified and order created successfully.',
            orderId: orderData.orderId,
            transactionId: transactionId
        });

    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
            console.error(`❌ Transaction aborted for PhonePe order ${orderId}:`, error);
        }
        session.endSession();
        
        // ✅ Log PhonePe payment verification failure
        auditLogger.error('PHONEPE_VERIFICATION_FAILED', {
            ip: req.ip,
            userId: req.body.userId || 'guest',
            orderId: orderId,
            transactionId: transactionId,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        console.error(`❌ PhonePe payment verification failed for order ${orderId}:`, error);
        throw error;
    }
}));
// PhonePe return URL handler - this is where users are redirected after payment
router.get('/phonepe-return/:orderId', asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { status, transactionId } = req.query;
    
    console.log(`🔄 PhonePe return handler called for order ${orderId} with status: ${status}`);
    
    try {
        const order = await Order.findOne({ orderId });
        
        if (!order) {
            console.error(`❌ Order not found: ${orderId}`);
            return res.redirect(`/store/order-confirmation.html?error=order_not_found&orderId=${orderId}`);
        }
        
        // ✅ Check if order was already cancelled due to timeout
        if (order.orderStatus === 'Canceled' && order.paymentStatus === 'Failed') {
            console.log(`⚠️ Order ${orderId} was already cancelled, redirecting to error page`);
            return res.redirect(`/store/order-confirmation.html?error=order_cancelled&orderId=${orderId}`);
        }
        
        const actualTransactionId = order.merchantTransactionId || transactionId || order.transactionId;
        
        
        if (!actualTransactionId) {
            console.error(`❌ No transaction ID found for order ${orderId}`);
            return res.redirect(`/store/order-confirmation.html?error=no_transaction_id&orderId=${orderId}`);
        }
        
        try {
            const paymentStatus = await phonePeService.checkPaymentStatus(actualTransactionId);
            
            if (paymentStatus.success) {
                // Update order status if not already updated
                if (order.paymentStatus !== 'Paid') {
                    await Order.findByIdAndUpdate(order._id, {
                        orderStatus: 'Processing',
                        paymentStatus: 'Paid',
                        transactionId: actualTransactionId,
                        phonePePaymentData: paymentStatus.fullResponse
                    });
                    
                    console.log(`✅ PhonePe payment successful for order ${orderId}`);
                    
                    // 📧 Send customer confirmation email (same as Razorpay)
                    try {
                        const emailService = require('../services/emailService');
                        
                        // Get customer email from order data
                        const customerEmail = order.isRegisteredUser ? order.userEmail : order.guestEmail;
                        
                        if (customerEmail) {
                            const emailOrderData = {
                                orderId: order.orderId,
                                totalAmount: order.finalTotal,
                                items: order.orderItems.map(item => ({
                                    name: item.name,
                                    quantity: item.quantity,
                                    price: item.price,
                                    image: item.image || '/placeholder.jpg'
                                })),
                                shippingAddress: `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.zipcode}`,
                                expectedDelivery: '2-4 business days'
                            };
                            
                            await emailService.sendCheckoutSuccessEmail(customerEmail, emailOrderData);
                            console.log(`📧 PhonePe return handler checkout success email sent to ${customerEmail}`);
                        } else {
                            console.warn('⚠️ No customer email found for PhonePe return handler checkout success email');
                        }
                    } catch (emailError) {
                        console.error('❌ Failed to send PhonePe return handler checkout success email:', emailError);
                        // Don't fail the return handler if email fails
                    }
                }
                
                return res.redirect(`/store/order-confirmation.html?orderId=${orderId}&status=success`);
            } else {
                return res.redirect(`/store/order-confirmation.html?error=payment_failed&orderId=${orderId}`);
            }
        } catch (verificationError) {
            console.error('❌ PhonePe payment verification error:', verificationError.message);
            return res.redirect(`/store/order-confirmation.html?error=verification_failed&orderId=${orderId}`);
        }
    } catch (error) {
        console.error('❌ PhonePe return handler error:', error.message);
        auditLogger.error('PHONEPE_RETURN_HANDLER_ERROR', {
            orderId,
            status,
            transactionId,
            error: error.message
        });
        return res.redirect(`/store/order-confirmation.html?error=system_error&orderId=${orderId}`);
    }
}));

// PhonePe webhook
router.post('/phonepe-webhook', asyncHandler(async (req, res) => {
    try {
        const xVerifyHeader = req.headers['x-verify'];
        const responseBody = JSON.stringify(req.body);
        
        // ✅ Verify webhook signature
        const isValid = phonePeService.verifyWebhookSignature(xVerifyHeader, responseBody);

        if (!isValid) {
            auditLogger.security('PHONEPE_WEBHOOK_SIGNATURE_FAILED', {
                ip: req.ip,
                headers: req.headers,
                body: req.body
            });
            return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
        }

        // ✅ Decode the response if it's base64 encoded
        let webhookData = req.body;
        if (req.body.response) {
            const decodedResponse = Buffer.from(req.body.response, 'base64').toString('utf-8');
            webhookData = JSON.parse(decodedResponse);
        }

        const transactionId = webhookData.data?.merchantTransactionId;
        const paymentState = webhookData.data?.state;
        
        if (!transactionId) {
            console.error('❌ PhonePe webhook: Missing transaction ID');
            return res.status(400).json({ success: false, message: 'Missing transaction ID.' });
        }

        // ✅ Log webhook received
        auditLogger.payment('PHONEPE_WEBHOOK_RECEIVED', {
            ip: req.ip,
            transactionId: transactionId,
            state: paymentState,
            code: webhookData.code,
            timestamp: new Date().toISOString()
        });

        // ✅ Find order by transaction ID
        const order = await Order.findOne({ transactionId: transactionId });
        
        if (!order) {
            console.error(`❌ PhonePe webhook: Order not found for transaction ${transactionId}`);
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        // ✅ Update order based on payment state
        if (paymentState === 'COMPLETED' && webhookData.code === 'PAYMENT_SUCCESS') {
            await Order.findByIdAndUpdate(order._id, {
                orderStatus: 'Processing',
                paymentStatus: 'Paid',
                phonePePaymentData: webhookData
            });
            
            // 📧 Send customer confirmation email (same as Razorpay)
            try {
                const emailService = require('../services/emailService');
                
                // Get customer email from order data
                const customerEmail = order.isRegisteredUser ? order.userEmail : order.guestEmail;
                
                if (customerEmail) {
                    const emailOrderData = {
                        orderId: order.orderId,
                        totalAmount: order.finalTotal,
                        items: order.orderItems.map(item => ({
                            name: item.name,
                            quantity: item.quantity,
                            price: item.price,
                            image: item.image || '/placeholder.jpg'
                        })),
                        shippingAddress: `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.zipcode}`,
                        expectedDelivery: '2-4 business days'
                    };
                    
                    await emailService.sendCheckoutSuccessEmail(customerEmail, emailOrderData);
                    console.log(`📧 PhonePe webhook checkout success email sent to ${customerEmail}`);
                } else {
                    console.warn('⚠️ No customer email found for PhonePe webhook checkout success email');
                }
            } catch (emailError) {
                console.error('❌ Failed to send PhonePe webhook checkout success email:', emailError);
                // Don't fail the webhook if email fails
            }
            
            // 🔔 Send PhonePe webhook success notifications
            try {
                const Seller = require('../seller-backend/models/sellerModel');
                const seller = await Seller.findOne().select('email _id');
                
                if (seller) {
                    const webhookNotificationData = {
                        orderId: order.orderId,
                        amount: (webhookData.data?.amount / 100 || order.finalTotal).toFixed(2),
                        customerName: order.isRegisteredUser ? order.userName : order.guestName,
                        products: order.orderItems.map(item => item.name)
                    };
                    
                    // Send notifications via email and push channels (no Socket.IO)
                    await notificationService.sendMultiChannelNotification(
                        seller._id.toString(),
                        notificationService.createOrderNotification(webhookNotificationData),
                        seller.email
                    );
                }
            } catch (webhookNotificationError) {
                console.error('❌ Failed to send PhonePe webhook notifications:', webhookNotificationError.message);
            }
            
            auditLogger.payment('PHONEPE_WEBHOOK_SUCCESS', {
                ip: req.ip,
                orderId: order.orderId,
                transactionId: transactionId,
                amount: webhookData.data?.amount,
                timestamp: new Date().toISOString()
            });
            
            console.log(`✅ PhonePe webhook: Order ${order.orderId} marked as paid`);
        } else {
            await Order.findByIdAndUpdate(order._id, {
                orderStatus: 'Canceled',
                paymentStatus: 'Failed',
                phonePePaymentData: webhookData
            });
            
            auditLogger.payment('PHONEPE_WEBHOOK_FAILURE', {
                ip: req.ip,
                orderId: order.orderId,
                transactionId: transactionId,
                state: paymentState,
                code: webhookData.code,
                timestamp: new Date().toISOString()
            });
            
            console.log(`❌ PhonePe webhook: Order ${order.orderId} payment failed`);
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ PhonePe webhook error:', error);
        auditLogger.error('PHONEPE_WEBHOOK_ERROR', {
            ip: req.ip,
            error: error.message,
            stack: error.stack,
            body: req.body,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({ success: false });
    }
}));

// ===== RAZORPAY WEBHOOK AND REFUND ROUTES =====

/**
 * Razorpay Webhook Endpoint
 * This endpoint receives notifications from Razorpay about payment events
 * URL: POST /api/orders/razorpay-webhook
 */
router.post('/razorpay-webhook', 
    paymentLimiter,
    asyncHandler(async (req, res) => {
        try {
            const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
            
            if (!secret) {
                auditLogger.error('RAZORPAY_WEBHOOK_SECRET_MISSING', {
                    ip: req.ip,
                    timestamp: new Date().toISOString()
                });
                return res.status(500).json({ status: 'Webhook secret not configured' });
            }

            const shasum = crypto.createHmac('sha256', secret);
            shasum.update(JSON.stringify(req.body));
            const digest = shasum.digest('hex');

            if (digest !== req.headers['x-razorpay-signature']) {
                auditLogger.security('RAZORPAY_WEBHOOK_SIGNATURE_FAILED', {
                    ip: req.ip,
                    headers: req.headers,
                    body: req.body
                });
                return res.status(400).json({ status: 'Signature mismatch' });
            }

            const event = req.body.event;
            const payload = req.body.payload;

            auditLogger.payment('RAZORPAY_WEBHOOK_RECEIVED', {
                ip: req.ip,
                event: event,
                eventId: req.body.event_id || 'unknown'
            });

            switch (event) {
                case 'payment.captured':
                    await handlePaymentCaptured(payload);
                    break;
                case 'payment.failed':
                    await handlePaymentFailed(payload);
                    break;
                case 'refund.processed':
                    await handleRefundProcessed(payload);
                    break;
                default:
                    console.log(`Unhandled Razorpay webhook event: ${event}`);
            }
            
            res.status(200).json({ status: 'ok' });
            
        } catch (error) {
            console.error(`Error handling Razorpay webhook:`, error);
            auditLogger.error('RAZORPAY_WEBHOOK_ERROR', {
                ip: req.ip,
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({ status: 'error', message: error.message });
        }
    })
);

// Webhook helper functions
async function handlePaymentCaptured(payload) {
    try {
        const { order_id, id: payment_id, amount, method } = payload.payment.entity;
        const orderId = payload.payment.entity.notes?.orderId;

        if (!orderId) {
            console.warn('No orderId found in payment notes');
            return;
        }

        const order = await Order.findOne({ orderId: orderId });
        if (order && order.paymentStatus !== 'Paid') {
            order.paymentStatus = 'Paid';
            order.orderStatus = 'Processing';
            order.transactionId = payment_id;
            await order.save();

            auditLogger.payment('RAZORPAY_PAYMENT_CAPTURED_WEBHOOK', {
                orderId: orderId,
                paymentId: payment_id,
                amount: amount / 100,
                method: method
            });

            // Send notification to seller
            try {
                const Seller = require('../seller-backend/models/sellerModel');
                const seller = await Seller.findOne().select('email _id');
                
                if (seller) {
                    const notificationData = {
                        orderId: order.orderId,
                        amount: (amount / 100).toFixed(2),
                        customerName: order.isRegisteredUser ? order.userName : order.guestName,
                        products: order.orderItems.map(item => item.name)
                    };
                    
                    await notificationService.sendMultiChannelNotification(
                        seller._id.toString(),
                        notificationService.createOrderNotification(notificationData),
                        seller.email
                    );
                }
            } catch (notificationError) {
                console.error('Failed to send webhook payment notification:', notificationError);
            }
        }
    } catch (error) {
        console.error('Error handling payment captured webhook:', error);
        throw error;
    }
}

async function handlePaymentFailed(payload) {
    try {
        const orderId = payload.payment.entity.notes?.orderId;
        
        if (!orderId) {
            console.warn('No orderId found in failed payment notes');
            return;
        }

        const order = await Order.findOne({ orderId: orderId });
        if (order && order.paymentStatus !== 'Paid') {
            order.paymentStatus = 'Failed';
            order.orderStatus = 'Canceled';
            await order.save();

            // Restore stock
            await restoreStock(order.orderItems);

            auditLogger.payment('RAZORPAY_PAYMENT_FAILED_WEBHOOK', {
                orderId: orderId,
                paymentId: payload.payment.entity.id,
                reason: payload.payment.entity.error_description
            });
        }
    } catch (error) {
        console.error('Error handling payment failed webhook:', error);
        throw error;
    }
}

async function handleRefundProcessed(payload) {
    try {
        const paymentId = payload.refund.entity.payment_id;
        const order = await Order.findOne({ transactionId: paymentId });

        if (order) {
            order.paymentStatus = 'Refunded';
            order.orderStatus = 'Canceled';
            
            // Add refund details
            order.refundDetails = {
                refundId: payload.refund.entity.id,
                refundAmount: payload.refund.entity.amount / 100,
                refundStatus: payload.refund.entity.status,
                refundDate: new Date(),
                refundReason: 'Webhook processed refund'
            };
            
            await order.save();

            // Restore stock
            await restoreStock(order.orderItems);

            auditLogger.payment('RAZORPAY_REFUND_PROCESSED_WEBHOOK', {
                orderId: order.orderId,
                paymentId: paymentId,
                refundId: payload.refund.entity.id,
                amount: payload.refund.entity.amount / 100
            });
        }
    } catch (error) {
        console.error('Error handling refund processed webhook:', error);
        throw error;
    }
}

/**
 * Process Full Refund
 * URL: POST /api/orders/refund/full
 */
router.post('/refund/full',
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json(handleValidationErrors(errors));
        }

        const { orderId, reason } = req.body;
        const adminId = 'admin'; // In production, get from authenticated user
        const ipAddress = req.ip;

        const session = await mongoose.startSession();
        
        try {
            session.startTransaction();

            // Find the order
            const order = await Order.findOne({ orderId }).session(session);
            if (!order) {
                await session.abortTransaction();
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            // Validate refund eligibility
            if (!order.transactionId) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Order has no valid payment transaction' });
            }

            if (order.paymentStatus === 'Refunded') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Order is already refunded' });
            }

            if (order.paymentStatus !== 'Paid') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Cannot refund unpaid order' });
            }

            // Log refund attempt
            auditLogger.payment('REFUND_INITIATED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                originalAmount: order.finalTotal,
                reason: reason,
                paymentId: order.transactionId
            });

            // Create refund with Razorpay
            const refundAmount = Math.round(order.finalTotal * 100); // Convert to paise
            
            console.log(`💰 Processing refund for order ${orderId}: ₹${order.finalTotal}`);
            
            const refundResponse = await razorpay.payments.refund(order.transactionId, {
                amount: refundAmount
            });
            
            console.log(`✅ Refund successful: ${refundResponse.id} - ₹${refundResponse.amount / 100}`);

            // Update order status
            order.paymentStatus = 'Refunded';
            order.orderStatus = 'Canceled';
            order.refundDetails = {
                refundId: refundResponse.id,
                refundAmount: refundResponse.amount / 100,
                refundStatus: refundResponse.status,
                refundDate: new Date(),
                refundReason: reason,
                processedBy: adminId
            };
            await order.save({ session });

            // Restore product stock
            for (const item of order.orderItems) {
                const product = await Product.findById(item.productId).session(session);
                if (product) {
                    product.stock += item.quantity;
                    await product.save({ session });
                    console.log(`✅ Stock restored for ${item.name}: +${item.quantity} units`);
                }
            }

            await session.commitTransaction();

            // Log successful refund
            auditLogger.payment('REFUND_SUCCESSFUL', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundId: refundResponse.id,
                amount: refundResponse.amount / 100,
                status: refundResponse.status
            });

            res.status(200).json({
                success: true,
                message: 'Full refund processed successfully',
                data: {
                    refundId: refundResponse.id,
                    amount: refundResponse.amount / 100,
                    status: refundResponse.status,
                    orderId: orderId
                }
            });

        } catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            
            // Extract Razorpay error details
            const razorpayError = error.error || error;
            const errorMessage = razorpayError.description || error.message || 'Failed to process refund';
            const errorCode = razorpayError.code || error.code || 'REFUND_ERROR';
            
            console.error(`❌ Refund failed for order ${orderId}:`, errorMessage);
            
            // Log refund failure
            auditLogger.error('REFUND_FAILED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                error: errorMessage,
                errorCode: errorCode
            });

            res.status(400).json({
                success: false,
                message: errorMessage,
                errorCode: errorCode
            });
        } finally {
            session.endSession();
        }
    })
);

/**
 * Process Partial Refund
 * URL: POST /api/orders/refund/partial
 */
router.post('/refund/partial',
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json(handleValidationErrors(errors));
        }

        const { orderId, amount, reason } = req.body;
        const refundAmount = parseFloat(amount);
        const adminId = 'admin'; // In production, get from authenticated user
        const ipAddress = req.ip;

        const session = await mongoose.startSession();
        
        try {
            session.startTransaction();

            // Find the order
            const order = await Order.findOne({ orderId }).session(session);
            if (!order) {
                await session.abortTransaction();
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            // Validate refund eligibility and amount
            if (!order.transactionId) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Order has no valid payment transaction' });
            }

            if (order.paymentStatus !== 'Paid') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Cannot refund unpaid order' });
            }
            
            if (refundAmount <= 0 || refundAmount > order.finalTotal) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Invalid refund amount' });
            }

            // Check existing partial refunds
            const existingRefunds = order.partialRefunds || [];
            const totalRefunded = existingRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0);
            
            if (totalRefunded + refundAmount > order.finalTotal) {
                await session.abortTransaction();
                return res.status(400).json({ 
                    success: false, 
                    message: `Cannot refund ₹${refundAmount}. Already refunded ₹${totalRefunded}. Maximum remaining: ₹${order.finalTotal - totalRefunded}` 
                });
            }

            // Log refund attempt
            auditLogger.payment('PARTIAL_REFUND_INITIATED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundAmount: refundAmount,
                originalAmount: order.finalTotal,
                reason: reason,
                paymentId: order.transactionId
            });

            // Create partial refund with Razorpay
            const refundData = {
                amount: Math.round(refundAmount * 100), // Convert to paise
                notes: {
                    orderId: orderId,
                    reason: reason,
                    adminId: adminId,
                    type: 'partial',
                    timestamp: new Date().toISOString()
                }
            };

            const refundResponse = await razorpay.payments.refund(order.transactionId, refundData);

            // Update order with partial refund details
            if (!order.partialRefunds) {
                order.partialRefunds = [];
            }
            
            order.partialRefunds.push({
                refundId: refundResponse.id,
                refundAmount: refundResponse.amount / 100,
                refundStatus: refundResponse.status,
                refundDate: new Date(),
                refundReason: reason,
                processedBy: adminId
            });

            // Update total refunded amount
            const newTotalRefunded = totalRefunded + (refundResponse.amount / 100);
            order.totalRefunded = newTotalRefunded;

            // If fully refunded, update status
            if (newTotalRefunded >= order.finalTotal) {
                order.paymentStatus = 'Refunded';
                order.orderStatus = 'Canceled';
            }

            await order.save({ session });
            await session.commitTransaction();

            // Log successful partial refund
            auditLogger.payment('PARTIAL_REFUND_SUCCESSFUL', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundId: refundResponse.id,
                amount: refundResponse.amount / 100,
                status: refundResponse.status,
                totalRefunded: newTotalRefunded
            });

            res.status(200).json({
                success: true,
                message: 'Partial refund processed successfully',
                data: {
                    refundId: refundResponse.id,
                    amount: refundResponse.amount / 100,
                    status: refundResponse.status,
                    orderId: orderId,
                    totalRefunded: newTotalRefunded
                }
            });

        } catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            
            // Log refund failure
            auditLogger.error('PARTIAL_REFUND_FAILED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundAmount: refundAmount,
                error: error.message,
                stack: error.stack
            });

            console.error('Partial refund error:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Failed to process partial refund'
            });
        } finally {
            session.endSession();
        }
    })
);

/**
 * Get Order Refunds
 * URL: GET /api/orders/refund/:orderId
 */
router.get('/refund/:orderId',

    asyncHandler(async (req, res) => {
        const { orderId } = req.params;

        try {
            const order = await Order.findOne({ orderId })
                .select('refundDetails partialRefunds totalRefunded paymentStatus finalTotal orderStatus');
                
            if (!order) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Order not found' 
                });
            }

            auditLogger.info('ORDER_REFUNDS_CHECKED', {
                ip: req.ip,
                orderId: orderId,
                totalRefunded: order.totalRefunded || 0
            });

            res.status(200).json({
                success: true,
                message: 'Order refunds retrieved successfully',
                data: {
                    orderId: orderId,
                    paymentStatus: order.paymentStatus,
                    orderStatus: order.orderStatus,
                    originalAmount: order.finalTotal,
                    fullRefund: order.refundDetails || null,
                    partialRefunds: order.partialRefunds || [],
                    totalRefunded: order.totalRefunded || 0
                }
            });

        } catch (error) {
            auditLogger.error('ORDER_REFUNDS_API_ERROR', {
                ip: req.ip,
                orderId: orderId,
                error: error.message
            });

            res.status(400).json({
                success: false,
                message: error.message || 'Failed to get order refunds'
            });
        }
    })
);

// ===== PHONEPE REFUND ROUTES =====

/**
 * Process PhonePe Full Refund
 * URL: POST /api/orders/phonepe-refund/full
 */
router.post('/phonepe-refund/full',
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json(handleValidationErrors(errors));
        }

        const { orderId, reason } = req.body;
        const adminId = 'admin'; // In production, get from authenticated user
        const ipAddress = req.ip;

        const session = await mongoose.startSession();
        
        try {
            session.startTransaction();

            // Find the order
            const order = await Order.findOne({ orderId }).session(session);
            if (!order) {
                await session.abortTransaction();
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            // Validate this is a PhonePe order
            if (order.paymentMethod !== 'phonepe') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'This is not a PhonePe order' });
            }

            // Validate refund eligibility
            if (!order.transactionId && !order.merchantTransactionId) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Order has no valid payment transaction' });
            }

            if (order.paymentStatus === 'Refunded') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Order is already refunded' });
            }

            if (order.paymentStatus !== 'Paid') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Cannot refund unpaid order' });
            }

            // Log refund attempt
            auditLogger.payment('PHONEPE_REFUND_INITIATED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                originalAmount: order.finalTotal,
                reason: reason,
                transactionId: order.transactionId || order.merchantTransactionId
            });

            // Generate unique refund ID
            const merchantRefundId = phonePeService.generateRefundId(orderId);
            const refundAmount = Math.round(order.finalTotal * 100); // Convert to paise
            const merchantTransactionId = order.transactionId || order.merchantTransactionId;

            // Process refund with PhonePe
            const refundData = {
                reason: reason,
                orderId: orderId,
                adminId: adminId
            };

            const refundResponse = await phonePeService.processRefund(
                merchantTransactionId,
                refundAmount,
                merchantRefundId,
                refundData
            );

            // Update order status
            order.paymentStatus = 'Refunded';
            order.orderStatus = 'Canceled';
            order.refundDetails = {
                refundId: refundResponse.merchantRefundId,
                phonePeRefundId: refundResponse.phonePeRefundId,
                refundAmount: order.finalTotal,
                refundStatus: refundResponse.status,
                refundDate: new Date(),
                refundReason: reason,
                processedBy: adminId
            };
            await order.save({ session });

            // Restore product stock
            for (const item of order.orderItems) {
                const product = await Product.findById(item.productId).session(session);
                if (product) {
                    product.stock += item.quantity;
                    await product.save({ session });
                    console.log(`✅ Stock restored for ${item.name}: +${item.quantity} units`);
                }
            }

            await session.commitTransaction();

            // Log successful refund
            auditLogger.payment('PHONEPE_REFUND_SUCCESSFUL', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundId: refundResponse.merchantRefundId,
                phonePeRefundId: refundResponse.phonePeRefundId,
                amount: order.finalTotal,
                status: refundResponse.status
            });

            res.status(200).json({
                success: true,
                message: 'PhonePe full refund processed successfully',
                data: {
                    refundId: refundResponse.merchantRefundId,
                    phonePeRefundId: refundResponse.phonePeRefundId,
                    amount: order.finalTotal,
                    status: refundResponse.status,
                    orderId: orderId
                }
            });

        } catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            
            // Log refund failure
            auditLogger.error('PHONEPE_REFUND_FAILED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                error: error.message,
                stack: error.stack
            });

            console.error('PhonePe full refund error:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Failed to process PhonePe refund'
            });
        } finally {
            session.endSession();
        }
    })
);

/**
 * Process PhonePe Partial Refund
 * URL: POST /api/orders/phonepe-refund/partial
 */
router.post('/phonepe-refund/partial',
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json(handleValidationErrors(errors));
        }

        const { orderId, amount, reason } = req.body;
        const refundAmount = parseFloat(amount);
        const adminId = 'admin'; // In production, get from authenticated user
        const ipAddress = req.ip;

        const session = await mongoose.startSession();
        
        try {
            session.startTransaction();

            // Find the order
            const order = await Order.findOne({ orderId }).session(session);
            if (!order) {
                await session.abortTransaction();
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            // Validate this is a PhonePe order
            if (order.paymentMethod !== 'phonepe') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'This is not a PhonePe order' });
            }

            // Validate refund eligibility and amount
            if (!order.transactionId && !order.merchantTransactionId) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Order has no valid payment transaction' });
            }

            if (order.paymentStatus !== 'Paid') {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Cannot refund unpaid order' });
            }
            
            if (!phonePeService.validateRefundAmount(refundAmount, order.finalTotal)) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: 'Invalid refund amount' });
            }

            // Check existing partial refunds
            const existingRefunds = order.partialRefunds || [];
            const totalRefunded = existingRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0);
            
            if (totalRefunded + refundAmount > order.finalTotal) {
                await session.abortTransaction();
                return res.status(400).json({ 
                    success: false, 
                    message: `Cannot refund ₹${refundAmount}. Already refunded ₹${totalRefunded}. Maximum remaining: ₹${order.finalTotal - totalRefunded}` 
                });
            }

            // Log refund attempt
            auditLogger.payment('PHONEPE_PARTIAL_REFUND_INITIATED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundAmount: refundAmount,
                originalAmount: order.finalTotal,
                reason: reason,
                transactionId: order.transactionId || order.merchantTransactionId
            });

            // Generate unique refund ID
            const merchantRefundId = phonePeService.generateRefundId(orderId);
            const refundAmountPaise = Math.round(refundAmount * 100); // Convert to paise
            const merchantTransactionId = order.transactionId || order.merchantTransactionId;

            // Process partial refund with PhonePe
            const refundData = {
                reason: reason,
                orderId: orderId,
                adminId: adminId
            };

            const refundResponse = await phonePeService.processRefund(
                merchantTransactionId,
                refundAmountPaise,
                merchantRefundId,
                refundData
            );

            // Update order with partial refund details
            if (!order.partialRefunds) {
                order.partialRefunds = [];
            }
            
            order.partialRefunds.push({
                refundId: refundResponse.merchantRefundId,
                phonePeRefundId: refundResponse.phonePeRefundId,
                refundAmount: refundAmount,
                refundStatus: refundResponse.status,
                refundDate: new Date(),
                refundReason: reason,
                processedBy: adminId
            });

            // Update total refunded amount
            const newTotalRefunded = totalRefunded + refundAmount;
            order.totalRefunded = newTotalRefunded;

            // If fully refunded, update status
            if (newTotalRefunded >= order.finalTotal) {
                order.paymentStatus = 'Refunded';
                order.orderStatus = 'Canceled';
            }

            await order.save({ session });
            await session.commitTransaction();

            // Log successful partial refund
            auditLogger.payment('PHONEPE_PARTIAL_REFUND_SUCCESSFUL', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundId: refundResponse.merchantRefundId,
                phonePeRefundId: refundResponse.phonePeRefundId,
                amount: refundAmount,
                status: refundResponse.status,
                totalRefunded: newTotalRefunded
            });

            res.status(200).json({
                success: true,
                message: 'PhonePe partial refund processed successfully',
                data: {
                    refundId: refundResponse.merchantRefundId,
                    phonePeRefundId: refundResponse.phonePeRefundId,
                    amount: refundAmount,
                    status: refundResponse.status,
                    orderId: orderId,
                    totalRefunded: newTotalRefunded
                }
            });

        } catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            
            // Log refund failure
            auditLogger.error('PHONEPE_PARTIAL_REFUND_FAILED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                refundAmount: refundAmount,
                error: error.message,
                stack: error.stack
            });

            console.error('PhonePe partial refund error:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Failed to process PhonePe partial refund'
            });
        } finally {
            session.endSession();
        }
    })
);

/**
 * Check PhonePe Refund Status
 * URL: GET /api/orders/phonepe-refund/status/:merchantRefundId
 */
router.get('/phonepe-refund/status/:merchantRefundId',
    apiLimiter,
    [
        param('merchantRefundId')
            .notEmpty()
            .withMessage('Merchant refund ID is required')
            .matches(/^REF_.*$/)
            .withMessage('Invalid PhonePe refund ID format')
    ],
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json(handleValidationErrors(errors));
        }

        const { merchantRefundId } = req.params;
        const ipAddress = req.ip;

        try {
            const refundStatus = await phonePeService.checkRefundStatus(merchantRefundId);

            auditLogger.info('PHONEPE_REFUND_STATUS_CHECKED', {
                ip: ipAddress,
                merchantRefundId: merchantRefundId,
                status: refundStatus.status,
                success: refundStatus.success
            });

            res.status(200).json({
                success: true,
                message: 'PhonePe refund status retrieved successfully',
                data: refundStatus
            });

        } catch (error) {
            auditLogger.error('PHONEPE_REFUND_STATUS_API_ERROR', {
                ip: ipAddress,
                merchantRefundId: merchantRefundId,
                error: error.message
            });

            res.status(400).json({
                success: false,
                message: error.message || 'Failed to get PhonePe refund status'
            });
        }
    })
);

/**
 * Get PhonePe Order Refunds
 * URL: GET /api/orders/phonepe-refund/order/:orderId
 */
router.get('/phonepe-refund/order/:orderId',
    apiLimiter,
    [
        param('orderId')
            .notEmpty()
            .withMessage('Order ID is required')
            .isLength({ min: 1, max: 100 })
            .withMessage('Order ID must be between 1 and 100 characters')
    ],
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json(handleValidationErrors(errors));
        }

        const { orderId } = req.params;
        const ipAddress = req.ip;

        try {
            const order = await Order.findOne({ orderId, paymentMethod: 'phonepe' })
                .select('refundDetails partialRefunds totalRefunded paymentStatus finalTotal orderStatus paymentMethod');
                
            if (!order) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'PhonePe order not found' 
                });
            }

            auditLogger.info('PHONEPE_ORDER_REFUNDS_CHECKED', {
                ip: ipAddress,
                orderId: orderId,
                totalRefunded: order.totalRefunded || 0,
                paymentMethod: order.paymentMethod
            });

            res.status(200).json({
                success: true,
                message: 'PhonePe order refunds retrieved successfully',
                data: {
                    orderId: orderId,
                    paymentStatus: order.paymentStatus,
                    orderStatus: order.orderStatus,
                    paymentMethod: order.paymentMethod,
                    originalAmount: order.finalTotal,
                    fullRefund: order.refundDetails || null,
                    partialRefunds: order.partialRefunds || [],
                    totalRefunded: order.totalRefunded || 0
                }
            });

        } catch (error) {
            auditLogger.error('PHONEPE_ORDER_REFUNDS_API_ERROR', {
                ip: ipAddress,
                orderId: orderId,
                error: error.message
            });

            res.status(400).json({
                success: false,
                message: error.message || 'Failed to get PhonePe order refunds'
            });
        }
    })
);

module.exports = router;
