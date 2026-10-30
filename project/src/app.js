'use strict';

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const fleetRoutes = require('./routes/fleetRoutes');
const authRoutes = require('./routes/authRoutes');
const alertRoutes = require('./routes/alertRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// The frontend server proxies /api from the same machine; trust its
// X-Forwarded-For so login lockouts apply per real client IP.
app.set('trust proxy', 'loopback');

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE (ORDER IS CRITICAL)
// ═══════════════════════════════════════════════════════════════════════════════

// 1. CORS - Enable cross-origin requests from frontend
app.use(cors({
  origin: ['http://192.168.21.216:3001','http://192.168.21.216:3000', 'http://localhost:3001','http://localhost:3000' , "http://192.168.20.69:3009","http://192.168.20.69:3000", "https://ems.itecknologi.com"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 2. Request logging (captures all requests)
app.use(requestLogger);

// 3. HTTP request logger (morgan for detailed logging)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// 4. Parse incoming JSON bodies
app.use(express.json({ limit: '100kb' }));

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Health-check — lets load balancers / monitoring confirm the service is alive
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api', fleetRoutes);
app.use('/api', authRoutes);
app.use('/api', alertRoutes);
app.use('/api', adminRoutes);

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING (ORDER MATTERS — LAST)
// ═══════════════════════════════════════════════════════════════════════════════

// 404 handler — catches requests to undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
});

// Global error handler — must be last middleware
app.use(errorHandler);

module.exports = app;
