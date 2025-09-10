/**
 * Auto-Cancel Service for Pending Orders
 * Runs periodically to cancel orders that have been pending for too long
 */

const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const { auditLogger } = require('../middleware/auditLogger');

class AutoCancelService {
    constructor() {
        this.intervalId = null;
        this.isRunning = false;
        this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
        this.timeoutMinutes = 30; // Cancel orders older than 30 minutes
    }

    /**
     * Start the auto-cancel service
     */
    start() {
        if (this.isRunning) {
            return;
        }
        
        this.isRunning = true;
        
        // Run immediately once
        this.checkPendingOrders();
        
        // Then run periodically
        this.intervalId = setInterval(() => {
            this.checkPendingOrders();
        }, this.checkInterval);
    }

    /**
     * Stop the auto-cancel service
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        this.isRunning = false;
    }

    /**
     * Main function to check and cancel pending orders
     */
    async checkPendingOrders() {
        try {
            const cutoffTime = new Date(Date.now() - (this.timeoutMinutes * 60 * 1000));
            
            // Find pending orders older than cutoff time
            const pendingOrders = await Order.find({
                paymentStatus: "Pending",
                orderStatus: { $in: ["Pending", "Processing"] },
                createdAt: { $lt: cutoffTime }
            }).select('orderId paymentMethod orderItems createdAt userId');
            
            if (pendingOrders.length === 0) {
                return;
            }
            
            let cancelledCount = 0;
            let errorCount = 0;
            
            for (const order of pendingOrders) {
                try {
                    await this.cancelOrder(order);
                    cancelledCount++;
                } catch (error) {
                    console.error(`❌ Failed to cancel order ${order.orderId}:`, error.message);
                    errorCount++;
                    
                    auditLogger.error('AUTO_CANCEL_ORDER_FAILED', {
                        orderId: order.orderId,
                        error: error.message,
                        orderAge: Math.round((Date.now() - order.createdAt.getTime()) / (1000 * 60))
                    });
                }
            }
            
            // Log summary
            auditLogger.info('AUTO_CANCEL_SUMMARY', {
                totalFound: pendingOrders.length,
                cancelled: cancelledCount,
                errors: errorCount,
                cutoffTime: cutoffTime.toISOString()
            });
            
        } catch (error) {
            console.error('❌ Auto-cancel service error:', error);
            auditLogger.error('AUTO_CANCEL_SERVICE_ERROR', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Cancel a specific order and restore stock
     */
    async cancelOrder(order) {
        const orderAge = Math.round((Date.now() - order.createdAt.getTime()) / (1000 * 60));
        
        // Restore stock for all items
        for (const item of order.orderItems) {
            try {
                const product = await Product.findById(item.productId);
                if (product) {
                    product.stock += item.quantity;
                    await product.save();
                } else {
                    // Product not found, skip stock restoration
                }
            } catch (stockError) {
                console.error(`❌ Failed to restore stock for ${item.name}:`, stockError.message);
                // Continue with other items even if one fails
            }
        }
        
        // Update order status
        await Order.findByIdAndUpdate(order._id, {
            orderStatus: "Canceled",
            paymentStatus: "Failed"
        });
        
        // Log cancellation
        auditLogger.warn('ORDER_AUTO_CANCELLED_BY_SERVICE', {
            orderId: order.orderId,
            paymentMethod: order.paymentMethod,
            userId: order.userId || 'guest',
            orderAge: orderAge,
            reason: `Payment timeout - ${this.timeoutMinutes} minutes expired`
        });
    }

    /**
     * Get service status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            checkInterval: this.checkInterval,
            timeoutMinutes: this.timeoutMinutes,
            nextCheckIn: this.isRunning ? Math.ceil((this.checkInterval - (Date.now() % this.checkInterval)) / 1000) : null
        };
    }

    /**
     * Force run check immediately (for testing/debugging)
     */
    async forceCheck() {
        await this.checkPendingOrders();
    }

    /**
     * Update configuration
     */
    updateConfig({ checkInterval, timeoutMinutes } = {}) {
        if (checkInterval && checkInterval !== this.checkInterval) {
            this.checkInterval = checkInterval;
            console.log(`📋 Updated check interval to ${checkInterval / 60000} minutes`);
            
            // Restart if running to apply new interval
            if (this.isRunning) {
                this.stop();
                this.start();
            }
        }
        
        if (timeoutMinutes && timeoutMinutes !== this.timeoutMinutes) {
            this.timeoutMinutes = timeoutMinutes;
            console.log(`📋 Updated timeout to ${timeoutMinutes} minutes`);
        }
    }
}

// Export singleton instance
module.exports = new AutoCancelService();
