/**
 * Secure Razorpay Refund Service
 * Handles refund processing with proper validation and security checks
 */

const Razorpay = require('razorpay');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const { auditLogger } = require('../middleware/auditLogger');
const mongoose = require('mongoose');

// Initialize Razorpay
let razorpay;
try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials not found in environment variables');
    }
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('✅ Razorpay initialized for refund service');
} catch (error) {
    console.error('❌ Failed to initialize Razorpay for refunds:', error.message);
}

class RefundService {
    /**
     * Process a full refund for an order
     * @param {string} orderId - The order ID to refund
     * @param {string} reason - Reason for refund
     * @param {string} adminId - ID of admin processing refund
     * @param {string} ipAddress - IP address of the request
     * @returns {Object} Refund result
     */
    static async processFullRefund(orderId, reason, adminId, ipAddress) {
        const session = await mongoose.startSession();
        
        try {
            session.startTransaction();

            // Find the order
            const order = await Order.findOne({ orderId }).session(session);
            if (!order) {
                throw new Error('Order not found');
            }

            // Validate refund eligibility
            await this.validateRefundEligibility(order);

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
            const refundData = {
                amount: Math.round(order.finalTotal * 100), // Convert to paise
                notes: {
                    orderId: orderId,
                    reason: reason,
                    adminId: adminId,
                    timestamp: new Date().toISOString()
                }
            };

            const refundResponse = await razorpay.payments.refund(order.transactionId, refundData);

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
            await this.restoreProductStock(order.orderItems, session);

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

            return {
                success: true,
                refundId: refundResponse.id,
                amount: refundResponse.amount / 100,
                status: refundResponse.status,
                orderId: orderId
            };

        } catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            
            // Log refund failure
            auditLogger.error('REFUND_FAILED', {
                ip: ipAddress,
                adminId: adminId,
                orderId: orderId,
                error: error.message,
                stack: error.stack
            });

            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Process a partial refund for an order
     * @param {string} orderId - The order ID to refund
     * @param {number} refundAmount - Amount to refund
     * @param {string} reason - Reason for refund
     * @param {string} adminId - ID of admin processing refund
     * @param {string} ipAddress - IP address of the request
     * @returns {Object} Refund result
     */
    static async processPartialRefund(orderId, refundAmount, reason, adminId, ipAddress) {
        const session = await mongoose.startSession();
        
        try {
            session.startTransaction();

            // Find the order
            const order = await Order.findOne({ orderId }).session(session);
            if (!order) {
                throw new Error('Order not found');
            }

            // Validate refund eligibility and amount
            await this.validateRefundEligibility(order);
            
            if (refundAmount <= 0 || refundAmount > order.finalTotal) {
                throw new Error('Invalid refund amount');
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
            const totalRefunded = order.partialRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0);
            order.totalRefunded = totalRefunded;

            // If fully refunded, update status
            if (totalRefunded >= order.finalTotal) {
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
                totalRefunded: totalRefunded
            });

            return {
                success: true,
                refundId: refundResponse.id,
                amount: refundResponse.amount / 100,
                status: refundResponse.status,
                orderId: orderId,
                totalRefunded: totalRefunded
            };

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

            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get refund status from Razorpay
     * @param {string} refundId - Razorpay refund ID
     * @returns {Object} Refund status
     */
    static async getRefundStatus(refundId) {
        try {
            const refund = await razorpay.refunds.fetch(refundId);
            return {
                success: true,
                refund: {
                    id: refund.id,
                    amount: refund.amount / 100,
                    status: refund.status,
                    createdAt: new Date(refund.created_at * 1000),
                    speedProcessed: refund.speed_processed,
                    speedRequested: refund.speed_requested
                }
            };
        } catch (error) {
            auditLogger.error('REFUND_STATUS_CHECK_FAILED', {
                refundId: refundId,
                error: error.message
            });
            throw new Error(`Failed to fetch refund status: ${error.message}`);
        }
    }

    /**
     * Validate if an order is eligible for refund
     * @param {Object} order - Order object
     */
    static async validateRefundEligibility(order) {
        // Check if order exists and has valid payment
        if (!order.transactionId) {
            throw new Error('Order has no valid payment transaction');
        }

        // Check if payment is already refunded
        if (order.paymentStatus === 'Refunded') {
            throw new Error('Order is already fully refunded');
        }

        // Check if payment was successful
        if (order.paymentStatus !== 'Paid') {
            throw new Error('Cannot refund unpaid order');
        }

        // Check if order is too old (e.g., 180 days)
        const orderAge = (new Date() - new Date(order.orderDate)) / (1000 * 60 * 60 * 24);
        if (orderAge > 180) {
            throw new Error('Order is too old for refund (180 days limit)');
        }

        return true;
    }

    /**
     * Restore product stock after refund
     * @param {Array} orderItems - Order items to restore stock for
     * @param {Object} session - MongoDB session
     */
    static async restoreProductStock(orderItems, session) {
        for (const item of orderItems) {
            const product = await Product.findById(item.productId).session(session);
            if (product) {
                product.stock += item.quantity;
                await product.save({ session });
                console.log(`✅ Stock restored for ${item.name}: +${item.quantity} units`);
            }
        }
    }

    /**
     * Get all refunds for an order
     * @param {string} orderId - Order ID
     * @returns {Object} Order refund details
     */
    static async getOrderRefunds(orderId) {
        try {
            const order = await Order.findOne({ orderId }).select('refundDetails partialRefunds totalRefunded paymentStatus');
            if (!order) {
                throw new Error('Order not found');
            }

            return {
                success: true,
                orderId: orderId,
                paymentStatus: order.paymentStatus,
                fullRefund: order.refundDetails || null,
                partialRefunds: order.partialRefunds || [],
                totalRefunded: order.totalRefunded || 0
            };
        } catch (error) {
            throw new Error(`Failed to get order refunds: ${error.message}`);
        }
    }
}

module.exports = RefundService;
