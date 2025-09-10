const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  // Initialize email transporter
  initializeTransporter() {
    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('❌ Email credentials missing in environment variables');
        return;
      }
      
      this.transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
      
      // Test the connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('❌ Email service connection failed:', error);
        }
      });
    } catch (error) {
      console.error('❌ Email service initialization failed:', error.message);
    }
  }

  // Send successful checkout email
  async sendCheckoutSuccessEmail(userEmail, orderData) {
    if (!this.transporter) {
      console.error('❌ Email transporter not initialized');
      return false;
    }

    const template = this.getCheckoutSuccessTemplate(orderData);
    
    try {
      await this.transporter.sendMail({
        from: `"${process.env.STORE_NAME || 'Ripe’n Red'}" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Order Confirmation - #${orderData.orderId}`,
        html: template
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to send checkout success email:', error.message);
      return false;
    }
  }

  // Send successful signup email
  async sendSignupSuccessEmail(userEmail, userData) {
    if (!this.transporter) {
      console.error('❌ Email transporter not initialized');
      return false;
    }

    const template = this.getSignupSuccessTemplate(userData);
    
    try {
      await this.transporter.sendMail({
        from: `"${process.env.STORE_NAME || 'Ripe’n Red'}" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Welcome to ${process.env.STORE_NAME || 'Our Store'}!`,
        html: template
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to send signup success email:', error.message);
      return false;
    }
  }

  // Send payment failure email
  async sendPaymentFailureEmail(userEmail, paymentData) {
    if (!this.transporter) {
      console.error('❌ Email transporter not initialized');
      return false;
    }

    const template = this.getPaymentFailureTemplate(paymentData);
    
    try {
      await this.transporter.sendMail({
        from: `"${process.env.STORE_NAME || 'Ripe’n Red'}" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Payment Failed - Order #${paymentData.orderId}`,
        html: template
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to send payment failure email:', error.message);
      return false;
    }
  }

  // Professional checkout success template
  getCheckoutSuccessTemplate(orderData) {
    const itemsHtml = orderData.items.map(item => `
      <tr>
        <td style="padding: 15px; border-bottom: 1px solid #eee;">
          <div style="display: flex; align-items: center;">
            <img src="${item.image || '/placeholder.jpg'}" alt="${item.name}" 
                 style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; margin-right: 15px;">
            <div>
              <h4 style="margin: 0; color: #333; font-size: 16px;">${item.name}</h4>
              <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Qty: ${item.quantity}</p>
            </div>
          </div>
        </td>
        <td style="padding: 15px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; color: #333;">
          ₹${item.price * item.quantity}
        </td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8f9fa;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 20px rgba(169,17,1,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Order Confirmed! 🎉</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Thank you for your purchase</p>
          </div>
          
          <!-- Order Details -->
          <div style="padding: 30px;">
            <div style="background: linear-gradient(145deg, #a91101 0%, #d32f2f 100%); padding: 25px; border-radius: 15px; margin-bottom: 25px; box-shadow: 0 8px 25px rgba(169,17,1,0.3);">
              <h2 style="color: white; margin: 0 0 15px 0; font-size: 20px; text-align: center;">Order Confirmation</h2>
              <div style="background: rgba(255,255,255,0.9); padding: 20px; border-radius: 10px; backdrop-filter: blur(10px);">
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Order ID:</strong> #${orderData.orderId}</p>
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Order Date:</strong> ${new Date().toLocaleDateString()}</p>
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Total Amount:</strong> <span style="color: #a91101; font-weight: bold; font-size: 18px;">₹${orderData.totalAmount}</span></p>
              </div>
            </div>
            
            <!-- Logo -->
            <div style="text-align: center; margin: 30px 0;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241640/ripenred1_h4z0wf.png" 
                   alt="Store Logo" 
                   style="width: 200px; height: auto; border-radius: 10px; box-shadow: 0 4px 15px rgba(169,17,1,0.2);">
            </div>
            
            <!-- Items -->
            <h3 style="color: #a91101; margin: 0 0 20px 0; font-size: 20px; text-align: center; border-bottom: 2px solid #a91101; padding-bottom: 10px;">Items Ordered</h3>
            <table style="width: 100%; border-collapse: collapse; background-color: white; border-radius: 15px; overflow: hidden; box-shadow: 0 4px 20px rgba(169,17,1,0.1); border: 2px solid #a91101;">
              ${itemsHtml}
              <tr style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%);">
                <td style="padding: 20px; font-weight: bold; color: white; font-size: 18px;">Total</td>
                <td style="padding: 20px; text-align: right; font-weight: bold; color: white; font-size: 20px;">₹${orderData.totalAmount}</td>
              </tr>
            </table>
            
            <!-- Track Order Button -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/store/guest-dashboard.html" 
                 style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; font-size: 18px; box-shadow: 0 6px 20px rgba(169,17,1,0.4); transition: transform 0.3s ease;">
                🔍 Track Your Order
              </a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); padding: 30px; text-align: center; color: white;">
            <div style="margin-bottom: 15px;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241862/logo2_plbtj1.png" 
                   alt="Store Logo" 
                   style="width: 150px; height: auto; border-radius: 8px;">
            </div>
            <p style="margin: 0; color: white; font-size: 16px; font-weight: bold;">Thank you for choosing us!</p>
            <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
              Questions? Contact us at ${process.env.EMAIL_USER}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Professional signup success template
  getSignupSuccessTemplate(userData) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8f9fa;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 20px rgba(169,17,1,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Welcome Aboard! 🎆</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Your account has been created successfully</p>
          </div>
          
          <!-- Welcome Aboard Box -->
          <div style="padding: 30px; text-align: center;">
            <div style="background: linear-gradient(145deg, #a91101 0%, #d32f2f 100%); padding: 25px; border-radius: 20px; margin-bottom: 25px; box-shadow: 0 8px 25px rgba(169,17,1,0.3);">
              <h2 style="color: white; margin: 0 0 10px 0; font-size: 24px; text-align: center;">🎉 Welcome Aboard! 🎉</h2>
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 18px;">You're now part of our amazing community!</p>
            </div>
            
            <!-- Logo Below Welcome Box -->
            <div style="text-align: center; margin: 25px 0;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241640/ripenred1_h4z0wf.png" 
                   alt="Store Logo" 
                   style="width: 200px; height: auto; border-radius: 15px; box-shadow: 0 6px 20px rgba(169,17,1,0.3);">
            </div>
            
            <!-- Welcome Content -->
            <div style="text-align: left; margin-top: 30px;">
              <h2 style="color: #a91101; margin: 0 0 20px 0; font-size: 24px; text-align: center;">Hello ${userData.name}! 👋</h2>
              <p style="color: #666; line-height: 1.8; font-size: 16px; margin: 0 0 25px 0; text-align: center;">
                We're absolutely thrilled to have you join our community! Your account has been successfully created and you're now ready to explore our amazing collection of premium products.
              </p>
              
              <!-- Account Details -->
              <div style="background: linear-gradient(145deg, #a91101 0%, #d32f2f 100%); padding: 25px; border-radius: 15px; margin: 25px 0; box-shadow: 0 6px 20px rgba(169,17,1,0.2);">
                <h3 style="color: white; margin: 0 0 15px 0; font-size: 20px; text-align: center;">Account Information</h3>
                <div style="background: rgba(255,255,255,0.9); padding: 20px; border-radius: 10px;">
                  <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Email:</strong> ${userData.email}</p>
                  <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Account Created:</strong> ${new Date().toLocaleDateString()}</p>
                  <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Status:</strong> <span style="color: #28a745; font-weight: bold;">Active ✓</span></p>
                </div>
              </div>
              
              <!-- Features -->
              <div style="margin: 35px 0;">
                <h3 style="color: #a91101; margin: 0 0 25px 0; font-size: 22px; text-align: center; border-bottom: 2px solid #a91101; padding-bottom: 10px;">What's Next?</h3>
                <div style="display: grid; gap: 20px;">
                  <div style="display: flex; align-items: center; padding: 20px; background: linear-gradient(135deg, rgba(169,17,1,0.1) 0%, rgba(211,47,47,0.1) 100%); border: 2px solid #a91101; border-radius: 15px; box-shadow: 0 4px 15px rgba(169,17,1,0.1);">
                    <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 20px; font-size: 20px; box-shadow: 0 4px 10px rgba(169,17,1,0.3);">🛍️</div>
                    <div>
                      <h4 style="margin: 0; color: #a91101; font-size: 18px; font-weight: bold;">Start Shopping</h4>
                      <p style="margin: 5px 0 0 0; color: #666; font-size: 15px;">Browse our extensive premium product catalog</p>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; padding: 20px; background: linear-gradient(135deg, rgba(169,17,1,0.1) 0%, rgba(211,47,47,0.1) 100%); border: 2px solid #a91101; border-radius: 15px; box-shadow: 0 4px 15px rgba(169,17,1,0.1);">
                    <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 20px; font-size: 20px; box-shadow: 0 4px 10px rgba(169,17,1,0.3);">💳</div>
                    <div>
                      <h4 style="margin: 0; color: #a91101; font-size: 18px; font-weight: bold;">Secure Checkout</h4>
                      <p style="margin: 5px 0 0 0; color: #666; font-size: 15px;">Lightning-fast and ultra-secure payment options</p>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; padding: 20px; background: linear-gradient(135deg, rgba(169,17,1,0.1) 0%, rgba(211,47,47,0.1) 100%); border: 2px solid #a91101; border-radius: 15px; box-shadow: 0 4px 15px rgba(169,17,1,0.1);">
                    <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 20px; font-size: 20px; box-shadow: 0 4px 10px rgba(169,17,1,0.3);">📦</div>
                    <div>
                      <h4 style="margin: 0; color: #a91101; font-size: 18px; font-weight: bold;">Track Orders</h4>
                      <p style="margin: 5px 0 0 0; color: #666; font-size: 15px;">Monitor your orders with real-time updates</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- CTA Button -->
              <div style="text-align: center; margin: 40px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}" 
                   style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); color: white; padding: 18px 45px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; font-size: 18px; box-shadow: 0 6px 20px rgba(169,17,1,0.4); transition: transform 0.3s ease;">
                  🚀 Start Shopping Now
                </a>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); padding: 30px; text-align: center; color: white;">
            <div style="margin-bottom: 15px;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241862/logo2_plbtj1.png" 
                   alt="Store Logo" 
                   style="width: 150px; height: auto; border-radius: 8px;">
            </div>
            <p style="margin: 0; color: white; font-size: 16px; font-weight: bold;">Welcome to our amazing family!</p>
            <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
              Need help? We're here for you! Contact us at ${process.env.EMAIL_USER}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Professional payment failure template
  getPaymentFailureTemplate(paymentData) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Failed</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8f9fa;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 20px rgba(169,17,1,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #ff6b6b 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Payment Failed ⚠️</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Don't worry, your order is still reserved</p>
          </div>
          
          <!-- Logo -->
          <div style="text-align: center; padding: 25px 0;">
             <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241640/ripenred1_h4z0wf.png" 
                 alt="Store Logo" 
                 style="width: 200px; height: auto; border-radius: 10px; box-shadow: 0 4px 15px rgba(169,17,1,0.2);">
          </div>
          
          <!-- Payment Issue Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #a91101; margin: 0 0 20px 0; font-size: 24px; text-align: center;">Hi ${paymentData.customerName || 'Valued Customer'},</h2>
            <p style="color: #666; line-height: 1.8; font-size: 16px; margin: 0 0 25px 0; text-align: center;">
              We encountered an issue processing your payment for order <strong style="color: #a91101;">#${paymentData.orderId}</strong>. <br>
              Don't worry - your items are still reserved and you can complete your purchase easily.
            </p>
            
            <!-- Order Summary -->
            <div style="background: linear-gradient(145deg, #a91101 0%, #d32f2f 100%); padding: 25px; border-radius: 15px; margin: 25px 0; box-shadow: 0 8px 25px rgba(169,17,1,0.3);">
              <h3 style="color: white; margin: 0 0 15px 0; font-size: 20px; text-align: center;">Order Summary</h3>
              <div style="background: rgba(255,255,255,0.95); padding: 20px; border-radius: 10px;">
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Order ID:</strong> #${paymentData.orderId}</p>
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Amount:</strong> <span style="color: #a91101; font-weight: bold;">₹${paymentData.amount}</span></p>
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Payment Method:</strong> ${paymentData.paymentMethod || 'Card'}</p>
                <p style="margin: 8px 0; color: #333; font-size: 16px;"><strong style="color: #a91101;">Status:</strong> <span style="color: #dc3545; font-weight: bold;">Failed ⚠️</span></p>
              </div>
            </div>
            
            <!-- Common Reasons -->
            <div style="margin: 30px 0;">
              <h3 style="color: #a91101; margin: 0 0 20px 0; font-size: 20px; text-align: center; border-bottom: 2px solid #a91101; padding-bottom: 10px;">Common Reasons for Payment Failure:</h3>
              <div style="background: linear-gradient(135deg, rgba(169,17,1,0.1) 0%, rgba(211,47,47,0.1) 100%); border: 2px solid #a91101; padding: 25px; border-radius: 15px; box-shadow: 0 4px 15px rgba(169,17,1,0.1);">
                <ul style="margin: 0; padding-left: 25px; color: #666; line-height: 2; font-size: 15px;">
                  <li><strong>Insufficient funds</strong> in your account</li>
                  <li><strong>Incorrect card details</strong> or expired card</li>
                  <li><strong>Bank security restrictions</strong> or 3D Secure failure</li>
                  <li><strong>Network connectivity issues</strong> during transaction</li>
                  <li><strong>Daily transaction limit</strong> exceeded</li>
                </ul>
              </div>
            </div>
            
            <!-- Action Steps -->
            <div style="background: linear-gradient(145deg, #a91101 0%, #d32f2f 100%); padding: 25px; border-radius: 15px; margin: 25px 0; box-shadow: 0 6px 20px rgba(169,17,1,0.2);">
              <h3 style="color: white; margin: 0 0 15px 0; font-size: 18px; text-align: center;">What You Can Do:</h3>
              <div style="background: rgba(255,255,255,0.95); padding: 20px; border-radius: 10px;">
                <ol style="margin: 0; padding-left: 25px; color: #333; line-height: 2; font-size: 15px;">
                  <li><strong style="color: #a91101;">Verify card details</strong> and try again</li>
                  <li><strong style="color: #a91101;">Check account balance</strong> and ensure sufficient funds</li>
                  <li><strong style="color: #a91101;">Try a different payment method</strong> (UPI, Net Banking)</li>
                  <li><strong style="color: #a91101;">Contact your bank</strong> if the issue persists</li>
                </ol>
              </div>
            </div>
            
            <!-- CTA Buttons -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/retry-payment/${paymentData.orderId}" 
                 style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); color: white; padding: 18px 35px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; font-size: 18px; margin: 0 10px 15px 10px; box-shadow: 0 6px 20px rgba(169,17,1,0.4);">
                🔄 Retry Payment
              </a><br>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/store/guest-dashboard.html" 
                 style="background: linear-gradient(135deg, #6c757d 0%, #495057 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px; margin: 0 10px 10px 10px; box-shadow: 0 4px 15px rgba(108,117,125,0.3);">
                📊 Track Order
              </a>
            </div>
            
            <!-- Help Section -->
            <div style="background: linear-gradient(135deg, rgba(169,17,1,0.1) 0%, rgba(211,47,47,0.1) 100%); border: 2px solid #a91101; padding: 25px; border-radius: 15px; text-align: center; margin: 25px 0; box-shadow: 0 4px 15px rgba(169,17,1,0.1);">
              <h4 style="color: #a91101; margin: 0 0 15px 0; font-size: 20px;">💬 Need Help?</h4>
              <p style="color: #666; margin: 0; font-size: 16px; line-height: 1.6;">
                Our support team is here to help you complete your purchase.<br>
                <strong>Contact us:</strong> <a href="mailto:${process.env.EMAIL_USER}" style="color: #a91101; text-decoration: none; font-weight: bold;">${process.env.EMAIL_USER}</a>
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); padding: 30px; text-align: center; color: white;">
            <div style="margin-bottom: 15px;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241862/logo2_plbtj1.png" 
                   alt="Store Logo" 
                   style="width: 150px; height: auto; border-radius: 8px;">
            </div>
            <p style="margin: 0; color: white; font-size: 16px; font-weight: bold;">We're here to help you complete your purchase!</p>
            <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
              ⏰ Your order will be held for 24 hours while you resolve the payment issue.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Send custom template email
  async sendCustomTemplateEmail(recipients, template, variables = {}) {
    if (!this.transporter) {
      console.error('❌ Email transporter not initialized');
      return { success: false, error: 'Email service not initialized' };
    }

    const results = {
      successful: [],
      failed: []
    };

    // Parse template content
    let { subject, content } = this.parseTemplate(template, variables);

    for (const email of recipients) {
      try {
        await this.transporter.sendMail({
          from: `"${process.env.STORE_NAME || 'Ripe’n Red'}" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: subject,
          html: content
        });
        
        results.successful.push(email);
      } catch (error) {
        console.error(`❌ Failed to send custom email to ${email}:`, error.message);
        results.failed.push({ email, error: error.message });
      }
    }

    return {
      success: true,
      results: results,
      total: recipients.length,
      successful: results.successful.length,
      failed: results.failed.length
    };
  }

  // Parse template and replace variables
  parseTemplate(template, variables = {}) {
    let subject = template.subject || 'Custom Email';
    let content = template.content || '';
    
    // Handle JSON objects in content
    if (typeof content === 'object' && content !== null) {
      content = JSON.stringify(content, null, 2);
    }
    
    // Decode HTML entities if content was HTML-encoded
    content = this.decodeHTMLEntities(content);

    // Replace variables in subject
    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`;
      subject = subject.replace(new RegExp(placeholder, 'g'), variables[key] || '');
    });

    // FIRST check if content is HTML BEFORE variable replacement
    // This prevents HTML from being treated as plain text after variable substitution
    const isHTMLBeforeReplacement = this.isCompleteHTMLDocument(content) || content.includes('<!DOCTYPE') || content.includes('<html');
    
    // Replace variables in content
    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`;
      content = content.replace(new RegExp(placeholder, 'g'), variables[key] || '');
    });

    // If it was HTML before replacement, keep it as HTML
    if (isHTMLBeforeReplacement) {
      return { subject, content };
    }
    
    // Check if content is already complete HTML after replacement
    const isCompleteHTML = this.isCompleteHTMLDocument(content);
    
    // If it's complete HTML, use as-is
    if (isCompleteHTML) {
      return { subject, content };
    }
    
    // Otherwise, check if it needs formatting
    const isAlreadyHTML = this.isHTMLContent(content);
    
    // Only wrap in template if it's not already HTML
    if (!isAlreadyHTML) {
      content = this.wrapContentInTemplate(content);
    }

    return { subject, content };
  }

  // Check if content is a complete HTML document
  isCompleteHTMLDocument(content) {
    const trimmedContent = content.trim().toLowerCase();
    return trimmedContent.startsWith('<!doctype') || 
           trimmedContent.startsWith('<html');
  }

  // Check if content is already HTML
  isHTMLContent(content) {
    const trimmedContent = content.trim();
    
    // Check for complete HTML document
    const htmlDocumentIndicators = [
      '<!DOCTYPE',
      '<html',
      '<HTML'
    ];
    
    // Check for any HTML tags (even fragments)
    const hasHTMLTags = /<[^>]+>/.test(content);
    
    // Check if it starts with HTML document indicators
    const isCompleteDocument = htmlDocumentIndicators.some(indicator => 
      trimmedContent.toLowerCase().startsWith(indicator.toLowerCase())
    );
    
    return isCompleteDocument || hasHTMLTags;
  }

  // Wrap plain content in email template
  wrapContentInTemplate(content) {
    // Check if content contains HTML tags (but is not a complete document)
    const hasHTMLTags = /<[^>]+>/.test(content);
    
    // If content has HTML tags, treat it as HTML, otherwise treat as plain text
    const formattedContent = hasHTMLTags ? content : this.convertPlainTextToHTML(content);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Custom Email</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8f9fa;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 20px rgba(169,17,1,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #989898ff 0%, #f5f5f5ff 100%); padding: 40px 30px; text-align: center;">
            <div style="margin-bottom: 15px;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241640/ripenred1_h4z0wf.png" 
                   alt="Store Logo" 
                   style="width: 200px; height: auto; border-radius: 8px;">
            </div>
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Custom Message</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 30px; color: #333; line-height: 1.6;">
            ${formattedContent}
          </div>
          
          <!-- Footer -->
          <div style="background: linear-gradient(135deg, #a91101 0%, #d32f2f 100%); padding: 30px; text-align: center; color: white;">
            <div style="margin-bottom: 15px;">
              <img src="https://res.cloudinary.com/dwpvgqh74/image/upload/v1755241862/logo2_plbtj1.png" 
                   alt="Store Logo" 
                   style="width: 80px; height: auto; border-radius: 8px;">
            </div>
            <p style="margin: 0; color: white; font-size: 16px; font-weight: bold;">Thank you for being with us!</p>
            <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
              Questions? Contact us at ${process.env.EMAIL_USER}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Convert plain text to HTML with proper formatting
  convertPlainTextToHTML(text) {
    // Check if the content looks like JSON
    if (this.isJSONContent(text)) {
      return this.formatJSONContent(text);
    }
    
    return text
      .replace(/\n\n/g, '</p><p style="margin: 15px 0; color: #333; font-size: 16px; line-height: 1.6;">')  // Double newlines become paragraph breaks
      .replace(/\n/g, '<br>')  // Single newlines become line breaks
      .replace(/^/, '<p style="margin: 15px 0; color: #333; font-size: 16px; line-height: 1.6;">')  // Start with paragraph
      .replace(/$/, '</p>');  // End with paragraph
  }

  // Check if content is JSON
  isJSONContent(content) {
    const trimmed = content.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || 
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  // Format JSON content for email display
  formatJSONContent(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      
      // Convert JSON object to readable HTML
      if (typeof parsed === 'object') {
        return this.objectToHTML(parsed);
      } else {
        return `<p style="margin: 15px 0; color: #333; font-size: 16px; line-height: 1.6;">${String(parsed)}</p>`;
      }
    } catch (error) {
      // If JSON parsing fails, treat as regular text
      return `<p style="margin: 15px 0; color: #333; font-size: 16px; line-height: 1.6;">${jsonText}</p>`;
    }
  }

  // Decode HTML entities
  decodeHTMLEntities(text) {
    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&#x2F;': '/',
      '&#x60;': '`',
      '&#x3D;': '='
    };
    
    return text.replace(/&[#\w\d]+;/g, (entity) => {
      return entities[entity] || entity;
    });
  }

  // Convert object/array to readable HTML
  objectToHTML(obj, depth = 0) {
    const indent = '  '.repeat(depth);
    const marginLeft = depth * 20;
    
    if (Array.isArray(obj)) {
      let html = `<div style="margin-left: ${marginLeft}px; margin: 10px 0;">`;
      obj.forEach((item, index) => {
        html += `<div style="margin: 8px 0; color: #333; font-size: 15px;">`;
        html += `<strong style="color: #a91101;">[${index}]:</strong> `;
        if (typeof item === 'object') {
          html += this.objectToHTML(item, depth + 1);
        } else {
          html += `<span style="color: #666;">${String(item)}</span>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
      return html;
    } else if (typeof obj === 'object' && obj !== null) {
      let html = `<div style="margin-left: ${marginLeft}px; margin: 10px 0;">`;
      Object.keys(obj).forEach(key => {
        html += `<div style="margin: 8px 0; color: #333; font-size: 15px;">`;
        html += `<strong style="color: #a91101;">${key}:</strong> `;
        if (typeof obj[key] === 'object') {
          html += this.objectToHTML(obj[key], depth + 1);
        } else {
          html += `<span style="color: #666;">${String(obj[key])}</span>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
      return html;
    } else {
      return `<span style="color: #666; font-size: 15px;">${String(obj)}</span>`;
    }
  }
}

module.exports = new EmailService();
