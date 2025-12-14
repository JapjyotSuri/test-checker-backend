const clerk = require('../config/clerk');
const { pool } = require('../config/database');

/**
 * Verify Clerk JWT token and attach user to request
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the session token with Clerk
    const sessionClaims = await clerk.verifyToken(token);
    
    if (!sessionClaims) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    // Find user in database
    let result = await pool.query(
      'SELECT * FROM users WHERE clerk_id = $1',
      [sessionClaims.sub]
    );

    let user = result.rows[0];

    if (!user) {
      // Fetch user details from Clerk and create in DB
      const clerkUser = await clerk.users.getUser(sessionClaims.sub);
      
      result = await pool.query(`
        INSERT INTO users (clerk_id, email, first_name, last_name, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        sessionClaims.sub,
        clerkUser.emailAddresses[0]?.emailAddress || '',
        clerkUser.firstName,
        clerkUser.lastName,
        'USER'
      ]);
      
      user = result.rows[0];
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    req.user = user;
    req.clerkUserId = sessionClaims.sub;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Unauthorized - Token verification failed' });
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
  requireRole,
  requireAdmin,
  requireChecker,
  requireUser
};
