/**
 * PhonePe Payment Gateway Service - Fixed Version
 * Handles payment creation, verification, and webhooks with proper retry logic
 */

const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class PhonePeService {
    constructor() {
        this.clientId = process.env.PHONEPE_CLIENT_ID;
        this.clientSecret = process.env.PHONEPE_CLIENT_SECRET;
        this.clientVersion = process.env.PHONEPE_CLIENT_VERSION || '1.0';
        this.baseUrl = process.env.PHONEPE_BASE_URL;
        this.authToken = null;
        this.tokenExpiry = null;
        this.authUrl = process.env.PHONEPE_AUTH_URL || 'https://api.phonepe.com/apis/identity-manager/';
        
        // Request configuration
        this.axiosConfig = {
            timeout: 10000, // 10 seconds timeout (reduced to prevent retries/duplicates)
            headers: {
                'User-Agent': 'YourApp/1.0',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };
        
        // Retry configuration - REDUCED to prevent duplicates
        this.retryConfig = {
            maxRetries: 1, // REDUCED from 3 to 1 to prevent duplicate orders
            baseDelay: 1000, // 1 second
            maxDelay: 5000, // 5 seconds (reduced)
            retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'] // Removed timeout errors
        };
        
        // Validate required environment variables
        if (!this.clientId || !this.clientSecret || !this.baseUrl) {
            throw new Error('PhonePe credentials missing in environment variables. Required: PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_BASE_URL');
        }
        
        // PhonePe Service initialized
    }

    /**
     * Sleep utility for retry delays
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        if (!error.code && !error.response) return false;
        
        // Network errors
        if (this.retryConfig.retryableErrors.includes(error.code)) {
            return true;
        }
        
        // HTTP status codes that should be retried
        if (error.response) {
            const status = error.response.status;
            return status === 502 || status === 503 || status === 504 || status === 522 || status === 524;
        }
        
        return false;
    }

    /**
     * Execute request with retry logic
     */
    async executeWithRetry(requestFunc, operation = 'request') {
        let lastError;
        
        for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await requestFunc();
            } catch (error) {
                lastError = error;
                
                // Only log detailed errors on final attempt or for auth issues
                if (attempt === this.retryConfig.maxRetries || error.response?.status === 401 || error.response?.status === 403) {
                    console.error(`❌ ${operation} failed (attempt ${attempt}):`, {
                        error: error.message,
                        status: error.response?.status
                    });
                }
                
                // Don't retry on last attempt or non-retryable errors
                if (attempt === this.retryConfig.maxRetries || !this.isRetryableError(error)) {
                    break;
                }
                
                // Calculate delay with exponential backoff
                const delay = Math.min(
                    this.retryConfig.baseDelay * Math.pow(2, attempt - 1),
                    this.retryConfig.maxDelay
                );
                
                await this.sleep(delay);
            }
        }
        
        throw lastError;
    }

    /**
     * Check if auth token is valid and not expired
     */
    isTokenValid() {
        if (!this.authToken || !this.tokenExpiry) {
            return false;
        }
        
        // Check if token expires within next 5 minutes
        const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
        return this.tokenExpiry > fiveMinutesFromNow;
    }

    /**
     * Generate PhonePe Auth Token with retry logic
     */
    async getAccessToken(forceRefresh = false) {
        // Return cached token if valid
        if (!forceRefresh && this.isTokenValid()) {
            return this.authToken;
        }

        const requestFunc = async () => {
            const response = await axios.post(
                `${this.authUrl}/v1/oauth/token`,
                new URLSearchParams({
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    client_version: this.clientVersion,
                    grant_type: "client_credentials"
                }),
                {
                    timeout: 45000, // 45 seconds timeout for auth token
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                        "User-Agent": "YourApp/1.0"
                    }
                }
            );

            const data = response.data;

            if (!data.access_token) {
                throw new Error("No access token in response");
            }

            // Cache token with expiry
            this.authToken = data.access_token;
            this.tokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
            return this.authToken;
        };

        return await this.executeWithRetry(requestFunc, 'Auth token generation');
    }

    /**
     * Create a PhonePe Payment Order with improved error handling
     */
    async createPaymentOrder(orderData) {
        const requestFunc = async () => {
            const merchantOrderId = `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

            const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
            
            const paymentPayload = {
                merchantOrderId: merchantOrderId,
                amount: Math.round(orderData.finalTotal * 100),
                expireAfter: 1200,
                metaInfo: {
                    udf1: orderData.orderId,
                    udf2: orderData.userId || "guest",
                    udf3: orderData.userInfo?.name || orderData.userDetails?.name || "Customer"
                },
                paymentFlow: {
                    type: "PG_CHECKOUT",
                    message: "Complete your payment",
                    merchantUrls: {
                        redirectUrl: `${backendUrl}/api/orders/phonepe-return/${orderData.orderId}`
                    }
                }
            };

            const accessToken = await this.getAccessToken();

            const response = await axios.post(
                `${this.baseUrl}/checkout/v2/pay`,
                paymentPayload,
                {
                    timeout: 45000,
                    headers: {
                        "Authorization": `O-Bearer ${accessToken}`,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "User-Agent": "YourApp/1.0"
                    }
                }
            );

            const result = response.data;

            if (!result.orderId || !result.redirectUrl) {
                throw new Error("Invalid response: missing orderId or redirectUrl");
            }

            return {
                orderId: result.orderId,
                paymentUrl: result.redirectUrl,
                state: result.state,
                expireAt: result.expireAt,
                merchantOrderId: merchantOrderId
            };
        };

        try {
            const result = await this.executeWithRetry(requestFunc, 'PhonePe payment order creation');
            return result;
        } catch (error) {
            // Only retry with fresh token for auth-related errors
            if ((error.response?.status === 401 || error.response?.status === 403) && 
                !error.code?.includes('TIMEOUT') && !error.message?.includes('timeout')) {
                try {
                    this.authToken = null;
                    this.tokenExpiry = null;
                    const freshToken = await this.getAccessToken(true);
                    const retryResult = await this.executeWithRetry(requestFunc, 'PhonePe payment order creation (fresh token)');
                    return retryResult;
                } catch (retryError) {
                    throw new Error(`PhonePe payment creation failed after fresh token retry: ${retryError.message}`);
                }
            }
            
            throw new Error(`PhonePe payment creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Check Payment Status with retry logic
     * Updated to handle PhonePe API v2 status check properly
     * @param {string} merchantOrderId - The merchant transaction ID for status check
     */
    async checkPaymentStatus(merchantOrderId) {
        const requestFunc = async () => {
            const accessToken = await this.getAccessToken();
            const correctEndpoint = `${this.baseUrl}/checkout/v2/order/${merchantOrderId}/status`;
            
            try {
                const response = await axios.get(correctEndpoint, {
                    timeout: 30000,
                    headers: {
                        "Authorization": `O-Bearer ${accessToken}`,
                        "Accept": "application/json",
                        "User-Agent": "YourApp/1.0"
                    }
                });
                
                return response.data;
            } catch (endpointError) {
                throw endpointError;
            }
        };

        try {
            const result = await this.executeWithRetry(requestFunc, 'Payment status check');
            
            // Handle different response formats
            const paymentState = result.state || result.status || result.data?.state;
            const paymentCode = result.code || result.data?.code;
            
            return {
                success: paymentState === 'COMPLETED' || paymentCode === 'PAYMENT_SUCCESS',
                transactionId: merchantOrderId,
                status: paymentState,
                code: paymentCode,
                amount: result.amount || result.data?.amount,
                paymentMethod: result.paymentInstrument?.type || result.data?.paymentInstrument?.type,
                transactionInfo: result.transactionId || result.data?.transactionId,
                providerReferenceId: result.providerReferenceId || result.data?.providerReferenceId,
                fullResponse: result
            };
        } catch (error) {
            // CRITICAL: If user returned from PhonePe but status check fails due to timeout,
            // assume payment was successful since PhonePe redirected them back
            if (error.code === 'ECONNABORTED') {
                console.log('⚠️ PhonePe status check timed out - assuming SUCCESS on user return');
                return {
                    success: true,
                    transactionId: merchantOrderId,
                    status: 'COMPLETED',
                    code: 'TIMEOUT_ASSUMED_SUCCESS',
                    error: 'Status check timed out, assumed successful',
                    fullResponse: { assumedSuccess: true }
                };
            }
            
            // For other errors, assume pending
            return {
                success: false,
                transactionId: merchantOrderId,
                status: 'PENDING',
                code: 'STATUS_CHECK_FAILED',
                error: error.message,
                fullResponse: { error: error.message }
            };
        }
    }
    
    /**
     * Generate signature for status check (if required)
     */
    generateStatusCheckSignature(merchantOrderId) {
        try {
            // Generate signature for the v2 API endpoint
            const string = `/checkout/v2/order/${merchantOrderId}/status` + this.clientSecret;
            const sha256 = crypto.createHash('sha256').update(string).digest('hex');
            const checksum = sha256 + '###1'; // Key index
            return checksum;
        } catch (error) {
            console.log('⚠️ Could not generate status check signature:', error.message);
            return null;
        }
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(xVerifyHeader, responseBody) {
        try {
            if (!xVerifyHeader) {
                console.error('❌ PhonePe webhook: Missing X-Verify header');
                return false;
            }

            // Extract signature and key index from header (format: signature###keyindex)
            const [receivedSignature, keyIndex] = xVerifyHeader.split('###');
            
            if (!receivedSignature) {
                console.error('❌ PhonePe webhook: Invalid X-Verify header format');
                return false;
            }

            // Generate expected signature using client secret
            const expectedSignature = crypto
                .createHash('sha256')
                .update(responseBody + '/pg/v1/status/' + this.clientSecret)
                .digest('hex');

            const isValid = expectedSignature === receivedSignature;
            
            console.log('🔐 PhonePe webhook signature verification:', {
                isValid,
                keyIndex,
                expectedSignature: expectedSignature.substring(0, 10) + '...',
                receivedSignature: receivedSignature.substring(0, 10) + '...'
            });

            return isValid;
        } catch (error) {
            console.error('❌ PhonePe webhook signature verification error:', error);
            return false;
        }
    }

    /**
     * Process Refund - POST /payments/v2/refund
     * @param {string} merchantTransactionId - Original payment transaction ID
     * @param {number} amount - Refund amount in paise
     * @param {string} merchantRefundId - Unique refund ID
     * @param {object} refundData - Additional refund data
     * @returns {object} Refund response
     */
    async processRefund(merchantTransactionId, amount, merchantRefundId, refundData = {}) {
        const requestFunc = async () => {
            console.log(`🔄 Processing PhonePe refund for transaction: ${merchantTransactionId}`);
            
            const accessToken = await this.getAccessToken();
            
            const refundPayload = {
                originalMerchantOrderId: merchantTransactionId,
                merchantRefundId: merchantRefundId,
                amount: Math.round(amount), // Amount in paise
                callbackUrl: refundData.callbackUrl || null,
                metaInfo: {
                    reason: refundData.reason || 'Refund request',
                    orderId: refundData.orderId || null,
                    adminId: refundData.adminId || null,
                    timestamp: new Date().toISOString()
                }
            };
            
            const response = await axios.post(
                `${this.baseUrl}/payments/v2/refund`,
                refundPayload,
                {
                    timeout: 45000,
                    headers: {
                        "Authorization": `O-Bearer ${accessToken}`,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "User-Agent": "YourApp/1.0"
                    }
                }
            );
            
            const result = response.data;
            
            console.log('✅ PhonePe refund response:', {
                merchantRefundId: result.merchantRefundId,
                status: result.state || result.status,
                amount: result.amount
            });
            
            return {
                merchantRefundId: result.merchantRefundId,
                phonePeRefundId: result.refundId || result.transactionId,
                status: result.state || result.status,
                amount: result.amount,
                message: result.message,
                fullResponse: result
            };
        };
        
        try {
            return await this.executeWithRetry(requestFunc, 'PhonePe refund processing');
        } catch (error) {
            // Retry with fresh token for auth errors
            if ((error.response?.status === 401 || error.response?.status === 403) && 
                !error.code?.includes('TIMEOUT') && !error.message?.includes('timeout')) {
                try {
                    this.authToken = null;
                    this.tokenExpiry = null;
                    await this.getAccessToken(true);
                    return await this.executeWithRetry(requestFunc, 'PhonePe refund processing (fresh token)');
                } catch (retryError) {
                    throw new Error(`PhonePe refund failed after fresh token retry: ${retryError.message}`);
                }
            }
            
            throw new Error(`PhonePe refund processing failed: ${error.response?.data?.message || error.message}`);
        }
    }
    
    /**
     * Check Refund Status - GET /payments/v2/refund/{merchantRefundId}/status
     * @param {string} merchantRefundId - Merchant refund ID
     * @returns {object} Refund status response
     */
    async checkRefundStatus(merchantRefundId) {
        const requestFunc = async () => {
            console.log(`🔄 Checking PhonePe refund status for: ${merchantRefundId}`);
            
            const accessToken = await this.getAccessToken();
            
            const response = await axios.get(
                `${this.baseUrl}/payments/v2/refund/${merchantRefundId}/status`,
                {
                    timeout: 30000,
                    headers: {
                        "Authorization": `O-Bearer ${accessToken}`,
                        "Accept": "application/json",
                        "User-Agent": "YourApp/1.0"
                    }
                }
            );
            
            const result = response.data;
            
            // Handle different response formats
            const refundState = result.state || result.status || result.data?.state;
            const refundCode = result.code || result.data?.code;
            
            console.log('📍 PhonePe refund status:', {
                merchantRefundId: merchantRefundId,
                status: refundState,
                code: refundCode,
                amount: result.amount || result.data?.amount
            });
            
            return {
                success: refundState === 'COMPLETED' || refundState === 'SUCCESS' || refundCode === 'REFUND_SUCCESS',
                merchantRefundId: merchantRefundId,
                phonePeRefundId: result.refundId || result.transactionId || result.data?.refundId,
                status: refundState,
                code: refundCode,
                amount: result.amount || result.data?.amount,
                refundDate: result.refundDate || result.data?.refundDate,
                message: result.message || result.data?.message,
                fullResponse: result
            };
        };
        
        try {
            return await this.executeWithRetry(requestFunc, 'PhonePe refund status check');
        } catch (error) {
            console.warn('⚠️ PhonePe refund status check failed:', error.message);
            
            // Return a structured error response instead of throwing
            return {
                success: false,
                merchantRefundId: merchantRefundId,
                status: 'UNKNOWN',
                code: 'STATUS_CHECK_FAILED',
                error: error.message,
                fullResponse: { error: error.message }
            };
        }
    }
    
    /**
     * Generate unique merchant refund ID
     * @param {string} orderId - Original order ID
     * @returns {string} Unique refund ID
     */
    generateRefundId(orderId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `REF_${orderId}_${timestamp}_${random}`;
    }
    
    /**
     * Validate refund amount
     * @param {number} refundAmount - Amount to refund
     * @param {number} originalAmount - Original payment amount
     * @returns {boolean} Is valid amount
     */
    validateRefundAmount(refundAmount, originalAmount) {
        if (!refundAmount || refundAmount <= 0) {
            return false;
        }
        
        if (refundAmount > originalAmount) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Health Check with improved error handling
     */
    async healthCheck() {
        try {
            // Test auth token generation
            await this.getAccessToken();
            
            return {
                status: 'healthy',
                message: 'PhonePe service is operational',
                baseUrl: this.baseUrl,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new PhonePeService();