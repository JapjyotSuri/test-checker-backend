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
      // Fetch user details from Clerk
      const clerkUser = await clerk.users.getUser(sessionClaims.sub);
      const email = (clerkUser.emailAddresses?.[0]?.emailAddress || '').trim().toLowerCase();

      if (!email) {
        return res.status(401).json({ error: 'Unauthorized - No email from Clerk' });
      }

      // Check if user already exists by email (e.g. created by webhook or previous sign-up)
      result = await pool.query(
        'SELECT * FROM users WHERE LOWER(email) = $1',
        [email]
      );
      user = result.rows[0];

      if (user) {
        // Link existing user to this Clerk account (update clerk_id)
        result = await pool.query(`
          UPDATE users SET clerk_id = $1, first_name = $2, last_name = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
          RETURNING *
        `, [sessionClaims.sub, clerkUser.firstName, clerkUser.lastName, user.id]);
        user = result.rows[0];
        console.log('[Auth] Existing user linked to Clerk:', user.id, user.email);
      } else {
        // Insert or update by email (handles race: two requests at once, or duplicate from different clerk_id)
        result = await pool.query(`
          INSERT INTO users (clerk_id, email, first_name, last_name, role)
          VALUES ($1, $2, $3, $4, 'USER')
          ON CONFLICT (email) DO UPDATE SET
            clerk_id = EXCLUDED.clerk_id,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `, [
          sessionClaims.sub,
          email,
          clerkUser.firstName,
          clerkUser.lastName
        ]);
        user = result.rows[0];
        console.log('[Auth] User synced in DB:', user.id, user.email);
      }
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
 * Optional auth: if Authorization header present, verify and attach user.
 * Otherwise continue without user (useful for public endpoints where published content is visible).
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const sessionClaims = await clerk.verifyToken(token);
    if (!sessionClaims) {
      req.user = null;
      return next();
    }

    // Find user in database
    let result = await pool.query(
      'SELECT * FROM users WHERE clerk_id = $1',
      [sessionClaims.sub]
    );

    let user = result.rows[0];
    if (!user) {
      // Try to find by email and link
      const clerkUser = await clerk.users.getUser(sessionClaims.sub);
      const email = (clerkUser.emailAddresses?.[0]?.emailAddress || '').trim().toLowerCase();
      if (email) {
        result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
        user = result.rows[0];
        if (user) {
          result = await pool.query(`
            UPDATE users SET clerk_id = $1, first_name = $2, last_name = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
          `, [sessionClaims.sub, clerkUser.firstName, clerkUser.lastName, user.id]);
          user = result.rows[0];
        }
      }
    }

    if (user && !user.is_active) {
      // treat as no user but do not block public access here
      req.user = null;
      return next();
    }

    req.user = user || null;
    req.clerkUserId = sessionClaims.sub;
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
  requireUser
};
