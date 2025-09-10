const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class AuditLogger {
  constructor() {
    this.logDir = path.join(__dirname, '../logs/audit');
    this.ensureLogDirectory();
    this.setupLogRotation();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  // ✅ Log Rotation with Compression
  setupLogRotation() {
    // Run log rotation daily at midnight
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const timeUntilMidnight = midnight.getTime() - now.getTime();
    
    setTimeout(() => {
      this.performLogRotation();
      // Schedule next rotation every 24 hours
      setInterval(() => this.performLogRotation(), 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
  }

  async performLogRotation() {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = new Date();
      
      for (const file of files) {
        if (!file.endsWith('.log') && !file.endsWith('.gz')) continue;
        
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        const fileAge = now.getTime() - stats.mtime.getTime();
        const daysOld = fileAge / (1000 * 60 * 60 * 24);
        
        // Delete logs older than 30 days
        if (daysOld > 30) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Deleted old log: ${file}`);
          continue;
        }
        
        // Compress logs older than 7 days (if not already compressed)
        if (daysOld > 7 && file.endsWith('.log')) {
          await this.compressLogFile(filePath);
        }
      }
    } catch (error) {
      console.error('Log rotation error:', error);
    }
  }

  async compressLogFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const compressed = zlib.gzipSync(content);
      const compressedPath = filePath + '.gz';
      
      fs.writeFileSync(compressedPath, compressed);
      fs.unlinkSync(filePath); // Delete original uncompressed file
      
      console.log(`🗜️ Compressed log: ${path.basename(filePath)}`);
    } catch (error) {
      console.error('Compression error:', error);
    }
  }

  log(level, action, details) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      action,
      details,
      ip: details.ip || 'unknown',
      userId: details.userId || 'guest',
      orderId: details.orderId || 'none'
    };

    const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}-audit.log`);
    const logLine = JSON.stringify(logEntry) + '\n';

    // Write to file
    fs.appendFileSync(logFile, logLine);

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔍 [AUDIT] ${level.toUpperCase()}: ${action}`, logEntry);
    }
  }

  info(action, details) {
    this.log('info', action, details);
  }

  warn(action, details) {
    this.log('warn', action, details);
  }

  error(action, details) {
    this.log('error', action, details);
  }

  security(action, details) {
    this.log('security', action, details);
  }

  payment(action, details) {
    this.log('payment', action, details);
  }

  // ✅ Get storage usage info
  getStorageInfo() {
    try {
      const files = fs.readdirSync(this.logDir);
      let totalSize = 0;
      let logCount = 0;
      let compressedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        
        if (file.endsWith('.gz')) {
          compressedCount++;
        } else if (file.endsWith('.log')) {
          logCount++;
        }
      }
      
      return {
        totalSize: this.formatBytes(totalSize),
        logCount,
        compressedCount,
        totalFiles: files.length
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

const auditLogger = new AuditLogger();

// Middleware to add audit logging to requests
const auditMiddleware = (req, res, next) => {
  try {
    const originalSend = res.send;
    
    // Log request
    auditLogger.info('API_REQUEST', {
      ip: req.ip || 'unknown',
      method: req.method,
      path: req.path,
      userId: req.user?.userId || 'guest',
      userAgent: req.get('User-Agent') || 'unknown',
      timestamp: new Date().toISOString()
    });

    // Override res.send to log responses
    res.send = function(data) {
      try {
        let responseData = data;
        
        // Try to parse JSON if it's a string
        if (typeof data === 'string') {
          try {
            responseData = JSON.parse(data);
          } catch (e) {
            // If parsing fails, use the original string
            responseData = { rawData: data };
          }
        }
        
        // Log payment-related responses
        if (req.path.includes('/orders') || req.path.includes('/payment')) {
          auditLogger.payment('API_RESPONSE', {
            ip: req.ip || 'unknown',
            method: req.method,
            path: req.path,
            userId: req.user?.userId || 'guest',
            statusCode: res.statusCode,
            responseData: responseData,
            timestamp: new Date().toISOString()
          });
        }

        // Log security-related responses
        if (res.statusCode >= 400) {
          auditLogger.security('API_ERROR', {
            ip: req.ip || 'unknown',
            method: req.method,
            path: req.path,
            userId: req.user?.userId || 'guest',
            statusCode: res.statusCode,
            error: responseData.message || responseData.rawData || 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      } catch (e) {
        // Log the error but don't break the response
        console.error('Audit logging error:', e);
      }
      
      originalSend.call(this, data);
    };
  } catch (error) {
    // If audit logging fails, don't break the request
    console.error('Audit middleware error:', error);
  }

  next();
};

module.exports = { auditLogger, auditMiddleware };
