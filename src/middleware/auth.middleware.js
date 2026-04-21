const { verifyAccessToken } = require('../config/jwt');
const { pool } = require('../config/database');

/**
 * Verify JWT access token and attach user to request
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.split(' ')[1];

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized - Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [claims.sub]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized - User not found' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Unauthorized - Token verification failed' });
  }
};

/**
 * Optional auth: if Authorization header present, verify and attach user.
 * Otherwise continue without user.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      req.user = null;
      return next();
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [claims.sub]
    );

    const user = result.rows[0];
    req.user = (user && user.is_active) ? user : null;
    next();
  } catch (error) {
    console.error('OptionalAuth error:', error.message || error);
    req.user = null;
    next();
  }
};

/**
 * Require specific role(s)
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden - Insufficient permissions' });
    }
    next();
  };
};

const requireAdmin = requireRole('ADMIN');
const requireChecker = requireRole('CHECKER', 'ADMIN');
const requireUser = requireRole('USER', 'CHECKER', 'ADMIN');

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireChecker,
  requireUser,
};
