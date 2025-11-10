require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Routes
const telegramRoutes = require('./routes/telegram');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials (şu an sabit, ilerisi için database'e koy)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'kripto123';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-secret-token-2024';

// Admin tokens (actve oturum saklama)
let activeAdminTokens = [];

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning']
}));

// Ngrok browser warning bypass
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Admin authentication middleware
const verifyAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token && activeAdminTokens.includes(token)) {
    next();
  } else {
    res.status(401).json({ ok: false, error: 'Unauthorized: Admin token required' });
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Admin login endpoint
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    const token = `admin-token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    activeAdminTokens.push(token);
    
    // 24 saat sonra token'ı kaldır
    setTimeout(() => {
      activeAdminTokens = activeAdminTokens.filter(t => t !== token);
    }, 24 * 60 * 60 * 1000);
    
    res.json({
      ok: true,
      message: 'Login successful',
      token: token,
      expiresIn: '24h',
    });
  } else {
    res.status(401).json({
      ok: false,
      error: 'Invalid password',
    });
  }
});

// Admin logout endpoint
app.post('/admin/logout', verifyAdmin, (req, res) => {
  const token = req.headers['x-admin-token'];
  activeAdminTokens = activeAdminTokens.filter(t => t !== token);
  
  res.json({
    ok: true,
    message: 'Logout successful',
  });
});

// API routes
app.use('/api', telegramRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'Kripto Haber Mobil Backend API',
    endpoints: {
      health: '/health',
      admin_login: 'POST /admin/login',
      telegram_webhook: '/api/telegram-webhook',
      telegram_webhook_status: '/api/telegram-webhook-status',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Endpoint not found',
    path: req.path,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    ok: false,
    error: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     Kripto Haber Mobil Backend Server                        ║
║                                                              ║
║  Server running on: http://localhost:${PORT}                       ║
║  Health check: http://localhost:${PORT}/health              ║
║  Telegram webhook: POST http://localhost:${PORT}/api/telegram-webhook ║
║                                                              ║
║  Environment:                                                ║
║  - NODE_ENV: ${process.env.NODE_ENV || 'development'}                      ║
║  - Telegram Bot Token: ${process.env.TELEGRAM_BOT_TOKEN ? '✓ Configured' : '✗ Not configured'}       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

module.exports = app;
