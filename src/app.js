require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const testRoutes = require('./routes/test.routes');
const testSeriesRoutes = require('./routes/test-series.routes');
const attemptRoutes = require('./routes/attempt.routes');
const purchasesRoutes = require('./routes/purchases.routes');
const checkerRoutes = require('./routes/checker.routes');
const adminRoutes = require('./routes/admin.routes');
const debugRoutes = require('./routes/debug.routes');

// Import middleware
const { errorHandler } = require('./middleware/error.middleware');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
// Serve uploaded files. Allow embedding these files in an iframe from the local frontend
// (development convenience). We remove the X-Frame-Options header and add a
// Content-Security-Policy frame-ancestors that allows the frontend origin.
app.use('/uploads', (req, res, next) => {
  // Remove Helmet's X-Frame-Options for uploads so the file can be embedded from a different origin
  res.removeHeader('X-Frame-Options');
  // Allow the local frontend origin to embed files. In production, lock this down or remove.
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frontend}`);
  next();
}, express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/test-series', testSeriesRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/checkers', checkerRoutes);
app.use('/api/admin', adminRoutes);
// Developer-only debug endpoints (no auth) — remove or protect in production
app.use('/api/debug', debugRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = app;

