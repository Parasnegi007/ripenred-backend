const express = require('express');
const router = express.Router();
const invoiceService = require('../services/invoiceService');
const Order = require('../models/orderModel');
const authSeller = require('../middleware/authSeller');
const { auditLogger } = require('../middleware/auditLogger');
/**
 * Generate single invoice for an order
 * GET /api/invoices/generate/:orderId
 */
router.get('/generate/:orderId', authSeller, async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Find the order
        const order = await Order.findById(orderId).populate('userId');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Generate invoice
        const invoiceBuffer = await invoiceService.generateInvoice(order);
        const filename = invoiceService.generateFilename(order.orderId);

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', invoiceBuffer.length);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Download-Options', 'noopen');
        res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

        // Log invoice generation
        auditLogger.info('INVOICE_GENERATED', {
            ip: req.ip,
            sellerId: req.seller._id,
            orderId: orderId,
            filename: filename,
            timestamp: new Date().toISOString()
        });

        // Send PDF buffer
        res.send(invoiceBuffer);

    } catch (error) {
        console.error('Invoice generation error:', error);
        auditLogger.error('INVOICE_GENERATION_FAILED', {
            ip: req.ip,
            sellerId: req.seller?._id || 'unknown',
            orderId: req.params.orderId,
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({ 
            success: false, 
            message: 'Failed to generate invoice' 
        });
    }
});

/**
 * Generate bulk invoices for multiple orders
 * POST /api/invoices/bulk-generate
 */

router.post('/bulk-generate', authSeller, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select orders to generate invoices' });
    }

    const orders = await Order.find({ _id: { $in: orderIds } }).populate('userId');
    if (orders.length === 0) return res.status(404).json({ success: false, message: 'No orders found' });

    // Generate bulk invoices using the new method
    const bulkInvoiceBuffer = await invoiceService.generateBulkInvoices(orders);
    const filename = `RipeNRed-Bulk-Invoices-${new Date().toISOString().split('T')[0]}.pdf`;

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', bulkInvoiceBuffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Log bulk invoice generation
    auditLogger.info('BULK_INVOICES_GENERATED', {
      ip: req.ip,
      sellerId: req.seller._id,
      orderCount: orders.length,
      orderIds,
      filename: filename,
      timestamp: new Date().toISOString()
    });

    // Send PDF buffer
    res.send(bulkInvoiceBuffer);

  } catch (error) {
    console.error('Bulk invoice generation error:', error);
    auditLogger.error('BULK_INVOICE_GENERATION_FAILED', {
      ip: req.ip,
      sellerId: req.seller?._id || 'unknown',
      orderIds: req.body.orderIds || [],
      error: error.message,
      timestamp: new Date().toISOString()
    });
    return res.status(500).json({ success: false, message: 'Failed to generate bulk invoices' });
  }
});

/**
 * Get invoice preview data for an order
 * GET /api/invoices/preview/:orderId
 */
router.get('/preview/:orderId', authSeller, async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Find the order
        const order = await Order.findById(orderId).populate('userId');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Return invoice preview data
        const previewData = {
            orderId: order.orderId,
            orderDate: order.createdAt,
            customerName: order.isRegisteredUser ? (order.userName || 'Registered User') : (order.guestName || 'Guest User'),
            customerEmail: order.isRegisteredUser ? (order.userEmail || 'N/A') : (order.guestEmail || 'N/A'),
            totalAmount: order.totalPrice - (order.discountAmount || 0) + (order.shippingCharges || 0),
            itemCount: order.orderItems?.length || 0,
            paymentMethod: order.paymentMethod,
            orderStatus: order.orderStatus
        };

        res.json({ success: true, data: previewData });

    } catch (error) {
        console.error('Invoice preview error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get invoice preview' 
        });
    }
});

module.exports = router;
