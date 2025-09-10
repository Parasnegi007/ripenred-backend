const nodemailer = require('nodemailer');
const webpush = require('web-push');

class NotificationService {
  constructor() {
    this.emailTransporter = null;
    this.pushSubscriptions = new Map(); // Store push subscriptions by seller ID
    
    this.initializeEmailService();
    this.initializePushService();
  }

  // Initialize Email Service
  initializeEmailService() {
    try {
      this.emailTransporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
      // Email notification service initialized
    } catch (error) {
      console.error('❌ Email service initialization failed:', error.message);
    }
  }

  // Initialize Web Push Service
  initializePushService() {
    try {
      // Generate VAPID keys if not present
      if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        const vapidKeys = webpush.generateVAPIDKeys();
        // VAPID keys generated - check console logs if needed
      }

      webpush.setVapidDetails(
        'mailto:' + (process.env.EMAIL_USER || 'your-email@example.com'),
        process.env.VAPID_PUBLIC_KEY || '',
        process.env.VAPID_PRIVATE_KEY || ''
      );
      // Push notification service initialized
    } catch (error) {
      console.error('❌ Push service initialization failed:', error.message);
    }
  }

  // Store push subscription for a seller
  subscribeToPush(sellerId, subscription) {
    this.pushSubscriptions.set(sellerId, subscription);
    // Push subscription stored for seller
  }


  // Send email notification
  async sendEmailNotification(sellerId, notification, sellerEmail) {
    if (!this.emailTransporter || !sellerEmail) {
      console.log('⚠️ Email service not configured or no email provided');
      return;
    }

    const emailTemplate = this.generateEmailTemplate(notification);
    
    try {
      await this.emailTransporter.sendMail({
         from: `"${process.env.STORE_NAME || 'Ripe n Red'}" <${process.env.EMAIL_USER}>`,
        to: sellerEmail,
        subject: `${notification.title} - Seller Dashboard Alert`,
        html: emailTemplate
      });
      
      // Email notification sent
    } catch (error) {
      console.error('❌ Email notification failed:', error.message);
    }
  }

  // Send push notification
  async sendPushNotification(sellerId, notification) {
    const subscription = this.pushSubscriptions.get(sellerId);
    
    if (!subscription) {
      // No push subscription found for seller
      return;
    }

    const pushPayload = JSON.stringify({
      title: notification.title,
      body: notification.message,
      icon: '/favicon.ico',
      badge: '/badge-icon.png',
      data: {
        url: notification.url || '/seller.html',
        sellerId: sellerId
      }
    });

    try {
      await webpush.sendNotification(subscription, pushPayload);
      // Push notification sent to seller
    } catch (error) {
      console.error('❌ Push notification failed:', error.message);
      // Remove invalid subscription
      this.pushSubscriptions.delete(sellerId);
    }
  }

  // Send notification via email and push channels only
  async sendMultiChannelNotification(sellerId, notification, sellerEmail = null) {
    const channels = [];

    // Email notification
    if (sellerEmail) {
      await this.sendEmailNotification(sellerId, notification, sellerEmail);
      channels.push('Email');
    }

    // Push notification
    await this.sendPushNotification(sellerId, notification);
    channels.push('Push');

    // Multi-channel notification sent
  }

  // Generate HTML email template
  generateEmailTemplate(notification) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Seller Dashboard Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 20px; }
          .alert { padding: 15px; border-radius: 5px; margin: 15px 0; }
          .alert-${notification.type} { 
            background: ${this.getAlertColor(notification.type)}; 
            border-left: 4px solid ${this.getAlertBorderColor(notification.type)}; 
          }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background: #4F46E5; 
            color: white; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 15px 0; 
          }
          .footer { text-align: center; color: #666; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏪 Seller Dashboard Alert</h1>
          </div>
          <div class="content">
            <div class="alert alert-${notification.type}">
              <h2>${notification.title}</h2>
              <p>${notification.message}</p>
              ${notification.data ? `<pre>${JSON.stringify(notification.data, null, 2)}</pre>` : ''}
            </div>
            ${notification.url ? `<a href="${notification.url}" class="button">View Dashboard</a>` : ''}
          </div>
          <div class="footer">
            <p>This is an automated notification from your Seller Dashboard</p>
            <p>Time: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Get alert colors for email templates
  getAlertColor(type) {
    const colors = {
      'success': '#d4edda',
      'warning': '#fff3cd',
      'error': '#f8d7da',
      'info': '#d1ecf1',
      'default': '#e2e3e5'
    };
    return colors[type] || colors.default;
  }

  getAlertBorderColor(type) {
    const colors = {
      'success': '#28a745',
      'warning': '#ffc107',
      'error': '#dc3545',
      'info': '#17a2b8',
      'default': '#6c757d'
    };
    return colors[type] || colors.default;
  }

  // Predefined notification templates for common events
  createOrderNotification(orderData) {
    return {
      type: 'success',
      title: '🛒 New Order Received!',
      message: `Order #${orderData.orderId} has been placed for ₹${orderData.amount}`,
      data: {
        orderId: orderData.orderId,
        amount: orderData.amount,
        customerName: orderData.customerName,
        products: orderData.products
      },
      url: `/seller.html?tab=orders&order=${orderData.orderId}`
    };
  }

  createLowStockNotification(productData) {
    return {
      type: 'warning',
      title: '⚠️ Low Stock Alert!',
      message: `${productData.name} is running low (${productData.stock} items left)`,
      data: {
        productId: productData.id,
        productName: productData.name,
        currentStock: productData.stock,
        threshold: productData.threshold
      },
      url: `/seller.html?tab=inventory&product=${productData.id}`
    };
  }

  createPaymentNotification(paymentData) {
    return {
      type: 'success',
      title: '💰 Payment Received!',
      message: `Payment of ₹${paymentData.amount} received for Order #${paymentData.orderId}`,
      data: {
        orderId: paymentData.orderId,
        amount: paymentData.amount,
        paymentId: paymentData.paymentId,
        method: paymentData.method
      },
      url: `/seller.html?tab=payments&payment=${paymentData.paymentId}`
    };
  }

  createReviewNotification(reviewData) {
    return {
      type: 'info',
      title: '⭐ New Review Received!',
      message: `${reviewData.customerName} left a ${reviewData.rating}-star review for ${reviewData.productName}`,
      data: {
        productId: reviewData.productId,
        productName: reviewData.productName,
        rating: reviewData.rating,
        review: reviewData.review,
        customerName: reviewData.customerName
      },
      url: `/seller.html?tab=reviews&product=${reviewData.productId}`
    };
  }

  // Get VAPID public key for frontend
  getVapidPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || '';
  }
}

module.exports = new NotificationService();
