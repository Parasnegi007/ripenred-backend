
const crypto = require('crypto');
const Order = require('../models/orderModel');
const { auditLogger } = require('../middleware/auditLogger');
const notificationService = require('../services/notificationService');

const handleRazorpayWebhook = async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
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
        payload: payload
    });

    try {
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
        console.error(`Error handling Razorpay webhook event ${event}:`, error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const handlePaymentCaptured = async (payload) => {
    const { order_id, id: payment_id, amount, method } = payload.payment.entity;
    const orderId = payload.payment.entity.notes.orderId;

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
        const seller = await getSeller();
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
    }
};

const handlePaymentFailed = async (payload) => {
    const orderId = payload.payment.entity.notes.orderId;

    const order = await Order.findOne({ orderId: orderId });
    if (order && order.paymentStatus !== 'Paid') {
        order.paymentStatus = 'Failed';
        order.orderStatus = 'Canceled';
        await order.save();

        auditLogger.payment('RAZORPAY_PAYMENT_FAILED_WEBHOOK', {
            orderId: orderId,
            paymentId: payload.payment.entity.id,
            reason: payload.payment.entity.error_description
        });
    }
};

const handleRefundProcessed = async (payload) => {
    const paymentId = payload.refund.entity.payment_id;
    const order = await Order.findOne({ transactionId: paymentId });

    if (order) {
        order.paymentStatus = 'Refunded';
        order.orderStatus = 'Canceled';
        await order.save();

        auditLogger.payment('RAZORPAY_REFUND_PROCESSED_WEBHOOK', {
            orderId: order.orderId,
            paymentId: paymentId,
            refundId: payload.refund.entity.id,
            amount: payload.refund.entity.amount / 100
        });
    }
};

const getSeller = async () => {
    const Seller = require('../seller-backend/models/sellerModel');
    return await Seller.findOne().select('email _id');
};

module.exports = {
    handleRazorpayWebhook
};

