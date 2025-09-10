const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const { body, validationResult } = require('express-validator');
const User = require('../models/userModel');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const authSeller = require('../middleware/authSeller');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Send checkout success email
router.post('/checkout-success', [
  body('userEmail').isEmail().withMessage('Valid email is required'),
  body('orderData').isObject().withMessage('Order data is required'),
  body('orderData.orderId').notEmpty().withMessage('Order ID is required'),
  body('orderData.totalAmount').isNumeric().withMessage('Total amount must be a number'),
  body('orderData.items').isArray().withMessage('Items must be an array'),
  body('orderData.shippingAddress').notEmpty().withMessage('Shipping address is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { userEmail, orderData } = req.body;
    
    console.log('📧 Received checkout success email request:', {
      userEmail,
      orderId: orderData.orderId,
      totalAmount: orderData.totalAmount,
      itemCount: orderData.items?.length || 0
    });

    const success = await emailService.sendCheckoutSuccessEmail(userEmail, orderData);
    
    if (success) {
      res.json({
        success: true,
        message: 'Checkout success email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send checkout success email'
      });
    }
  } catch (error) {
    console.error('Error sending checkout success email:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Send signup success email
router.post('/signup-success', [
  body('userEmail').isEmail().withMessage('Valid email is required'),
  body('name').notEmpty().withMessage('Name is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { userEmail, name } = req.body;
    
    const userData = {
      email: userEmail,
      name
    };

    const success = await emailService.sendSignupSuccessEmail(userEmail, userData);
    
    if (success) {
      res.json({
        success: true,
        message: 'Signup success email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send signup success email'
      });
    }
  } catch (error) {
    console.error('Error sending signup success email:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Send payment failure email
router.post('/payment-failure', [
  body('userEmail').isEmail().withMessage('Valid email is required'),
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('amount').isNumeric().withMessage('Amount must be a number')
], handleValidationErrors, async (req, res) => {
  try {
    const { userEmail, orderId, amount, customerName, paymentMethod, failureReason } = req.body;
    
    const paymentData = {
      orderId,
      amount,
      customerName,
      paymentMethod,
      failureReason
    };

    const success = await emailService.sendPaymentFailureEmail(userEmail, paymentData);
    
    if (success) {
      res.json({
        success: true,
        message: 'Payment failure email sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send payment failure email'
      });
    }
  } catch (error) {
    console.error('Error sending payment failure email:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Test email endpoint (for development/testing)
router.post('/test', [
  body('userEmail').isEmail().withMessage('Valid email is required'),
  body('type').isIn(['checkout', 'signup', 'payment-failure']).withMessage('Invalid email type')
], handleValidationErrors, async (req, res) => {
  try {
    const { userEmail, type } = req.body;
    let success = false;

    switch (type) {
      case 'checkout':
        const testOrderData = {
          orderId: 'TEST-' + Date.now(),
          totalAmount: 1299,
          items: [
            { name: 'Test Product', quantity: 1, price: 1299, image: '/placeholder.jpg' }
          ],
          shippingAddress: '123 Test Street, Test City, 12345',
          expectedDelivery: '3-5 business days'
        };
        success = await emailService.sendCheckoutSuccessEmail(userEmail, testOrderData);
        break;
        
      case 'signup':
        const testUserData = {
          email: userEmail,
          name: 'Test User'
        };
        success = await emailService.sendSignupSuccessEmail(userEmail, testUserData);
        break;
        
      case 'payment-failure':
        const testPaymentData = {
          orderId: 'TEST-' + Date.now(),
          amount: 1299,
          customerName: 'Test User',
          paymentMethod: 'Credit Card',
          failureReason: 'Insufficient funds'
        };
        success = await emailService.sendPaymentFailureEmail(userEmail, testPaymentData);
        break;
    }

    if (success) {
      res.json({
        success: true,
        message: `Test ${type} email sent successfully`
      });
    } else {
      res.status(500).json({
        success: false,
        message: `Failed to send test ${type} email`
      });
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// =============== SEMI-AUTOMATED MAIL SERVICE ===============

// Get all registered users for email selection - FIXED: Include _id or use email as identifier
router.get('/users', authSeller, async (req, res) => {
  try {
    const users = await User.find(
      { status: 'active' }, 
      { email: 1, name: 1, _id: 1 } // FIXED: Include _id or use email as unique identifier
    ).lean();
    
    res.json({
      success: true,
      users: users.map(user => ({
        _id: user._id, // Include _id for proper identification
        email: user.email,
        name: user.name || user.email.split('@')[0]
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// Send custom template email to provided email addresses - FIXED: Better error handling and response format
router.post('/send-custom', authSeller, upload.single('template'), async (req, res) => {
  try {
    console.log("📥 Incoming request body:", req.body);

    const { recipientEmails, manualEmails, variables } = req.body;
    let template = {};

    // Parse template from file or request body
    if (req.file) {
      const templatePath = req.file.path;
      const templateContent = fs.readFileSync(templatePath, 'utf8');
      template = JSON.parse(templateContent);

      // Clean up uploaded file
      fs.unlinkSync(templatePath);
    } else if (req.body.template) {
      template = typeof req.body.template === 'string'
        ? JSON.parse(req.body.template)
        : req.body.template;
    } else {
      return res.status(400).json({
        success: false,
        message: 'No template provided'
      });
    }

    // Validate template structure
    if (!template.subject || !template.content) {
      return res.status(400).json({
        success: false,
        message: 'Template must have subject and content fields'
      });
    }

    // Merge provided emails
    const allRecipients = [];

    // Directly add provided recipient emails
    if (recipientEmails && Array.isArray(recipientEmails)) {
      allRecipients.push(...recipientEmails);
    }

    // Add manual email addresses
    if (manualEmails) {
      const manualEmailArray = Array.isArray(manualEmails)
        ? manualEmails
        : manualEmails.split(',').map(email => email.trim());
      allRecipients.push(...manualEmailArray);
    }

    console.log("📧 Raw recipients before validation:", allRecipients);

    // Remove duplicates and validate emails
    const uniqueRecipients = [...new Set(allRecipients)];
    const validEmails = uniqueRecipients.filter(email => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    });

    console.log("✅ Valid email list:", validEmails);

    if (validEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid email addresses provided'
      });
    }

    // Parse variables if provided
    const templateVariables = variables
      ? (typeof variables === 'string' ? JSON.parse(variables) : variables)
      : {};

    // Send emails
    console.log(`📨 Sending custom emails to ${validEmails.length} recipients`);
    const result = await emailService.sendCustomTemplateEmail(
      validEmails,
      template,
      templateVariables
    );

    // FIXED: Ensure consistent response format that matches frontend expectations
    res.json({
      success: true,
      message: `Emails sent successfully`,
      stats: {
        total: validEmails.length,
        successful: result.successful || validEmails.length,
        failed: result.failed || 0
      },
      // Keep backward compatibility
      successful: result.successful || validEmails.length,
      failed: result.failed || 0,
      details: result.results
    });

  } catch (error) {
    console.error('❌ Error sending custom emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send custom emails',
      error: error.message,
      stats: {
        total: 0,
        successful: 0,
        failed: 0
      }
    });
  }
});

// Validate template file structure
router.post('/validate-template', authSeller, upload.single('template'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No template file uploaded'
      });
    }

    const templatePath = req.file.path;
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    try {
      const template = JSON.parse(templateContent);
      
      // Clean up uploaded file
      fs.unlinkSync(templatePath);
      
      // Validate required fields
      const requiredFields = ['subject', 'content'];
      const missingFields = requiredFields.filter(field => !template[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Template missing required fields: ${missingFields.join(', ')}`
        });
      }
      
      // Extract variables from template
      const variableRegex = /{{(\w+)}}/g;
      const subjectVars = (template.subject.match(variableRegex) || []).map(v => v.slice(2, -2));
      const contentVars = (template.content.match(variableRegex) || []).map(v => v.slice(2, -2));
      const allVariables = [...new Set([...subjectVars, ...contentVars])];
      
     res.json({
    valid: true,
    template: {
        subject: template.subject,
        content: template.content,
    },
    variables: allVariables
});

      
    } catch (parseError) {
      // Clean up uploaded file
      fs.unlinkSync(templatePath);
      
      res.status(400).json({
        success: false,
        message: 'Invalid JSON format in template file'
      });
    }
    
  } catch (error) {
    console.error('Error validating template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate template',
      error: error.message
    });
  }
});

module.exports = router;
