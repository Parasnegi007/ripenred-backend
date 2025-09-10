const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const authSeller = require('../middleware/authSeller');

// Get VAPID public key for web push notifications
router.get('/vapid-public-key', (req, res) => {
  try {
    const publicKey = notificationService.getVapidPublicKey();
    res.json({ publicKey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get VAPID public key' });
  }
});

// Subscribe to push notifications
router.post('/subscribe-push', authSeller, (req, res) => {
  try {
    const { subscription } = req.body;
    const sellerId = req.seller.id || req.seller._id;

    if (!subscription) {
      return res.status(400).json({ error: 'Subscription data required' });
    }

    notificationService.subscribeToPush(sellerId, subscription);
    res.json({ success: true, message: 'Push subscription registered' });
  } catch (error) {
    console.error('Push subscription error:', error);
    res.status(500).json({ error: 'Failed to register push subscription' });
  }
});

// Test notification endpoint (for development)
router.post('/test', authSeller, async (req, res) => {
  try {
    const { type = 'info', title = 'Test Notification', message = 'This is a test notification' } = req.body;
    const sellerId = req.seller.id || req.seller._id;
    const sellerEmail = req.seller.email;

    const testNotification = {
      type,
      title,
      message,
      data: { test: true, timestamp: new Date().toISOString() },
      url: '/seller.html'
    };

    await notificationService.sendMultiChannelNotification(
      sellerId, 
      testNotification, 
      sellerEmail
    );

    res.json({ 
      success: true, 
      message: 'Test notification sent via all channels',
      notification: testNotification
    });
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Send order notification (called from order processing)
router.post('/order', authSeller, async (req, res) => {
  try {
    const { orderData } = req.body;
    const sellerId = req.seller.id || req.seller._id;
    const sellerEmail = req.seller.email;

    const notification = notificationService.createOrderNotification(orderData);
    
    await notificationService.sendMultiChannelNotification(
      sellerId, 
      notification, 
      sellerEmail
    );

    res.json({ success: true, message: 'Order notification sent' });
  } catch (error) {
    console.error('Order notification error:', error);
    res.status(500).json({ error: 'Failed to send order notification' });
  }
});

// Send low stock notification
router.post('/low-stock', authSeller, async (req, res) => {
  try {
    const { productData } = req.body;
    const sellerId = req.seller.id || req.seller._id;
    const sellerEmail = req.seller.email;

    const notification = notificationService.createLowStockNotification(productData);
    
    await notificationService.sendMultiChannelNotification(
      sellerId, 
      notification, 
      sellerEmail
    );

    res.json({ success: true, message: 'Low stock notification sent' });
  } catch (error) {
    console.error('Low stock notification error:', error);
    res.status(500).json({ error: 'Failed to send low stock notification' });
  }
});

// Send payment notification
router.post('/payment', authSeller, async (req, res) => {
  try {
    const { paymentData } = req.body;
    const sellerId = req.seller.id || req.seller._id;
    const sellerEmail = req.seller.email;

    const notification = notificationService.createPaymentNotification(paymentData);
    
    await notificationService.sendMultiChannelNotification(
      sellerId, 
      notification, 
      sellerEmail
    );

    res.json({ success: true, message: 'Payment notification sent' });
  } catch (error) {
    console.error('Payment notification error:', error);
    res.status(500).json({ error: 'Failed to send payment notification' });
  }
});

// Send review notification
router.post('/review', authSeller, async (req, res) => {
  try {
    const { reviewData } = req.body;
    const sellerId = req.seller.id || req.seller._id;
    const sellerEmail = req.seller.email;

    const notification = notificationService.createReviewNotification(reviewData);
    
    await notificationService.sendMultiChannelNotification(
      sellerId, 
      notification, 
      sellerEmail
    );

    res.json({ success: true, message: 'Review notification sent' });
  } catch (error) {
    console.error('Review notification error:', error);
    res.status(500).json({ error: 'Failed to send review notification' });
  }
});

// Get notification settings for seller
router.get('/settings', authSeller, (req, res) => {
  // This would typically come from a database
  // For now, return default settings
  res.json({
    email: true,
    push: true,
    realtime: true,
    types: {
      orders: true,
      payments: true,
      lowStock: true,
      reviews: true
    }
  });
});

// Update notification settings
router.put('/settings', authSeller, (req, res) => {
  // This would typically save to a database
  // For now, just return success
  res.json({ success: true, message: 'Notification settings updated' });
});

module.exports = router;
