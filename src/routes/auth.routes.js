const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');
const { signAccessToken, signRefreshToken, verifyRefreshToken, getRefreshTokenExpiry } = require('../config/jwt');
const { sendOtpEmail } = require('../config/mailer');

/**
 * Generate a 6-digit OTP
 */
const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Issue tokens and store refresh token for a user
 */
const issueTokens = async (user) => {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });
  const refreshExpiry = getRefreshTokenExpiry();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [user.id, refreshToken, refreshExpiry]
  );

  // Keep last 5 refresh tokens per user
  await pool.query(
    `DELETE FROM refresh_tokens WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5
     )`,
    [user.id]
  );

  return { accessToken, refreshToken };
};

/**
 * POST /api/auth/send-otp
 * Send a 6-digit OTP to the provided email.
 * OTP is ONLY sent via email — never returned in the response.
 */
router.post('/send-otp', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Rate limit: max 3 OTPs per email in 10 minutes
  const recentOtps = await pool.query(
    `SELECT COUNT(*) FROM otps
     WHERE email = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalizedEmail]
  );

  if (parseInt(recentOtps.rows[0].count) >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  // Invalidate existing unused OTPs for this email
  await pool.query(
    `UPDATE otps SET used = true WHERE email = $1 AND used = false`,
    [normalizedEmail]
  );

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.query(
    `INSERT INTO otps (email, otp_code, expires_at) VALUES ($1, $2, $3)`,
    [normalizedEmail, otp, expiresAt]
  );

  try {
    await sendOtpEmail(normalizedEmail, otp);
  } catch (emailError) {
    console.error('[Auth] Failed to send OTP email:', emailError);
    return res.status(500).json({ error: 'Failed to send OTP email. Please try again.' });
  }

  // OTP is NEVER returned in the response — email only
  res.json({ message: 'OTP sent to your email' });
}));

/**
 * POST /api/auth/register
 * Register with email + password + OTP verification.
 * OTP must be verified first; password is set on account creation.
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, otp, firstName, lastName } = req.body;

  if (!email || !password || !otp) {
    return res.status(400).json({ error: 'Email, password, and OTP are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Verify OTP
  const otpResult = await pool.query(
    `SELECT * FROM otps
     WHERE email = $1 AND otp_code = $2 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail, otp.trim()]
  );

  if (otpResult.rows.length === 0) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  // Mark OTP as used
  await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [otpResult.rows[0].id]);

  // Check if user already exists
  const existing = await pool.query(
    'SELECT id, password_hash FROM users WHERE LOWER(email) = $1',
    [normalizedEmail]
  );

  if (existing.rows.length > 0) {
    const existingUser = existing.rows[0];
    if (existingUser.password_hash) {
      // Has a password — they should sign in normally
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }
    // Existing account without a password (migrated from Clerk) — set their password now
    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await pool.query(
      `UPDATE users SET
        password_hash = $1,
        first_name = COALESCE(NULLIF($2, ''), first_name),
        last_name = COALESCE(NULLIF($3, ''), last_name),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [passwordHash, firstName?.trim() || '', lastName?.trim() || '', existingUser.id]
    );
    const user = userResult.rows[0];
    console.log('[Auth] Existing user set password:', user.id, user.email);
    const { accessToken, refreshToken } = await issueTokens(user);
    return res.status(200).json({
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role, is_active: user.is_active },
      accessToken,
      refreshToken,
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const userResult = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, 'USER')
     RETURNING *`,
    [normalizedEmail, passwordHash, firstName?.trim() || null, lastName?.trim() || null]
  );

  const user = userResult.rows[0];
  console.log('[Auth] New user registered:', user.id, user.email);

  const { accessToken, refreshToken } = await issueTokens(user);

  res.status(201).json({
    user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role, is_active: user.is_active },
    accessToken,
    refreshToken,
  });
}));

/**
 * POST /api/auth/login
 * Sign in with email + password.
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const userResult = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1',
    [normalizedEmail]
  );

  const user = userResult.rows[0];

  if (!user || !user.password_hash) {
    if (user && !user.password_hash) {
      // Account exists but was created before passwords were added (Clerk migration)
      return res.status(401).json({
        error: 'This account has no password set. Please use Sign Up to set your password.',
        code: 'NO_PASSWORD'
      });
    }
    // Generic message to avoid email enumeration
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account is deactivated' });
  }

  const { accessToken, refreshToken } = await issueTokens(user);

  res.json({
    user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role, is_active: user.is_active },
    accessToken,
    refreshToken,
  });
}));

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access token.
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const tokenResult = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
    [refreshToken]
  );

  if (tokenResult.rows.length === 0) {
    return res.status(401).json({ error: 'Refresh token not found or expired' });
  }

  const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [claims.sub]);
  const user = userResult.rows[0];

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User not found or deactivated' });
  }

  const newAccessToken = signAccessToken({ sub: user.id, role: user.role });
  res.json({ accessToken: newAccessToken });
}));

/**
 * POST /api/auth/logout
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);
  }
  res.json({ message: 'Logged out successfully' });
}));

/**
 * POST /api/auth/forgot-password
 * Send OTP to email for password reset.
 * Always returns success to prevent email enumeration.
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const userResult = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = $1',
    [normalizedEmail]
  );

  // Always return success — don't reveal whether email exists
  if (userResult.rows.length === 0) {
    return res.json({ message: 'If that email exists, an OTP has been sent.' });
  }

  // Rate limit: max 3 OTPs per email in 10 minutes
  const recentOtps = await pool.query(
    `SELECT COUNT(*) FROM otps WHERE email = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalizedEmail]
  );

  if (parseInt(recentOtps.rows[0].count) >= 3) {
    return res.status(429).json({ error: 'Too many requests. Please wait 10 minutes.' });
  }

  await pool.query(`UPDATE otps SET used = true WHERE email = $1 AND used = false`, [normalizedEmail]);

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO otps (email, otp_code, expires_at) VALUES ($1, $2, $3)`,
    [normalizedEmail, otp, expiresAt]
  );

  try {
    await sendOtpEmail(normalizedEmail, otp, 'reset');
  } catch (emailError) {
    console.error('[Auth] Failed to send reset OTP:', emailError);
    return res.status(500).json({ error: 'Failed to send OTP email. Please try again.' });
  }

  res.json({ message: 'If that email exists, an OTP has been sent.' });
}));

/**
 * POST /api/auth/reset-password
 * Verify OTP and set new password.
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;

  if (!email || !otp || !password) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const otpResult = await pool.query(
    `SELECT * FROM otps
     WHERE email = $1 AND otp_code = $2 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail, otp.trim()]
  );

  if (otpResult.rows.length === 0) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [otpResult.rows[0].id]);

  const userRes = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
  const user = userRes.rows[0];

  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated' });

  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [passwordHash, user.id]
  );

  // Revoke all refresh tokens — force re-login everywhere
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [user.id]);

  res.json({ message: 'Password reset successfully. Please sign in with your new password.' });
}));

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

/**
 * PUT /api/auth/profile
 */
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { firstName, lastName } = req.body;
  const result = await pool.query(
    `UPDATE users SET first_name = $1, last_name = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 RETURNING *`,
    [firstName, lastName, req.user.id]
  );
  res.json({ user: result.rows[0] });
}));

module.exports = router;

/**
 * POST /api/auth/send-otp
 * Send a 6-digit OTP to the provided email address.
 * Creates a new user account if the email doesn't exist yet.
 */
router.post('/send-otp', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Rate limit: max 3 OTPs per email in 10 minutes
  const recentOtps = await pool.query(
    `SELECT COUNT(*) FROM otps 
     WHERE email = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalizedEmail]
  );

  if (parseInt(recentOtps.rows[0].count) >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  // Invalidate any existing unused OTPs for this email
  await pool.query(
    `UPDATE otps SET used = true WHERE email = $1 AND used = false`,
    [normalizedEmail]
  );

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.query(
    `INSERT INTO otps (email, otp_code, expires_at) VALUES ($1, $2, $3)`,
    [normalizedEmail, otp, expiresAt]
  );

  try {
    await sendOtpEmail(normalizedEmail, otp);
  } catch (emailError) {
    console.error('[Auth] Failed to send OTP email:', emailError);
    return res.status(500).json({ error: 'Failed to send OTP email. Please try again.' });
  }

  // In development, also return OTP in response for easy testing
  const devOtp = process.env.NODE_ENV === 'development' ? otp : undefined;

  res.json({
    message: 'OTP sent to your email',
    ...(devOtp && { otp: devOtp, note: 'OTP included in dev mode only' }),
  });
}));

/**
 * POST /api/auth/verify-otp
 * Verify OTP and return access + refresh tokens.
 * Creates user if they don't exist (first-time login = registration).
 */
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { email, otp, firstName, lastName } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Find valid OTP
  const otpResult = await pool.query(
    `SELECT * FROM otps 
     WHERE email = $1 AND otp_code = $2 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail, otp.trim()]
  );

  if (otpResult.rows.length === 0) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const otpRecord = otpResult.rows[0];

  // Mark OTP as used
  await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [otpRecord.id]);

  // Find or create user
  let userResult = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1',
    [normalizedEmail]
  );

  let user = userResult.rows[0];

  if (!user) {
    // New user — create account
    userResult = await pool.query(
      `INSERT INTO users (email, first_name, last_name, role)
       VALUES ($1, $2, $3, 'USER')
       RETURNING *`,
      [
        normalizedEmail,
        firstName?.trim() || null,
        lastName?.trim() || null,
      ]
    );
    user = userResult.rows[0];
    console.log('[Auth] New user created:', user.id, user.email);
  } else {
    // Update name if provided and not already set
    if ((firstName || lastName) && (!user.first_name || !user.last_name)) {
      userResult = await pool.query(
        `UPDATE users SET 
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING *`,
        [firstName?.trim() || null, lastName?.trim() || null, user.id]
      );
      user = userResult.rows[0];
    }
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account is deactivated' });
  }

  // Issue tokens
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });
  const refreshExpiry = getRefreshTokenExpiry();

  // Store refresh token in DB
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [user.id, refreshToken, refreshExpiry]
  );

  // Clean up old refresh tokens for this user (keep last 5)
  await pool.query(
    `DELETE FROM refresh_tokens WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5
     )`,
    [user.id]
  );

  res.json({
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      is_active: user.is_active,
    },
    accessToken,
    refreshToken,
  });
}));

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access token.
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  // Verify JWT signature
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  // Check token exists in DB and is not expired
  const tokenResult = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
    [refreshToken]
  );

  if (tokenResult.rows.length === 0) {
    return res.status(401).json({ error: 'Refresh token not found or expired' });
  }

  // Get user
  const userResult = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [claims.sub]
  );

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User not found or deactivated' });
  }

  // Issue new access token
  const newAccessToken = signAccessToken({ sub: user.id, role: user.role });

  res.json({ accessToken: newAccessToken });
}));

/**
 * POST /api/auth/logout
 * Revoke the refresh token.
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);
  }

  res.json({ message: 'Logged out successfully' });
}));

/**
 * GET /api/auth/me - Get current user profile
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

/**
 * PUT /api/auth/profile - Update current user profile
 */
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { firstName, lastName } = req.body;

  const result = await pool.query(
    `UPDATE users SET first_name = $1, last_name = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 RETURNING *`,
    [firstName, lastName, req.user.id]
  );

  res.json({ user: result.rows[0] });
}));

/**
 * PATCH /api/auth/role - Switch own role (dev/testing only)
 */
router.patch('/role', requireAuth, asyncHandler(async (req, res) => {
  const allowSwitch = process.env.ALLOW_ROLE_SWITCH === '1' || process.env.NODE_ENV === 'development';
  if (!allowSwitch) {
    return res.status(403).json({ error: 'Role switch is not enabled' });
  }

  const { role } = req.body;
  if (!['USER', 'CHECKER', 'ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Use USER, CHECKER, or ADMIN' });
  }

  const result = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
    [role, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: result.rows[0] });
}));

module.exports = router;
