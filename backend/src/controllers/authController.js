const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../config/database');
const { auditService } = require('../services/auditService');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_DURATION = parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 30;

const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

const authController = {
  login: asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new AppError('Username and password are required', 400, 'VALIDATION_ERROR');
    }

    // Get user
    const result = await query(
      `SELECT * FROM users WHERE username = $1`,
      [username.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    const user = result.rows[0];

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      throw new AppError(
        `Account locked. Try again in ${remainingMinutes} minutes`,
        423,
        'ACCOUNT_LOCKED'
      );
    }

    // Check if account is active
    if (!user.is_active) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      // Increment failed attempts
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      let lockUntil = null;

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        lockUntil = new Date(Date.now() + LOCKOUT_DURATION * 60000);
        logger.warn('Account locked due to failed attempts', { username });
      }

      await query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [newAttempts, lockUntil, user.id]
      );

      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // Reset failed attempts and update last login
    await query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1`,
      [user.id]
    );

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token hash
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokenHash, expiresAt, req.ip, req.get('User-Agent')]
    );

    // Audit log
    await auditService.log({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'users',
      entityId: user.id,
      req
    });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          agency: user.agency,
          mustChangePassword: user.must_change_password
        }
      }
    });
  }),

  logout: asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
        [tokenHash]
      );
    }

    await auditService.log({
      userId: req.user.id,
      action: 'LOGOUT',
      entityType: 'users',
      entityId: req.user.id,
      req
    });

    res.json({ success: true, message: 'Logged out successfully' });
  }),

  refreshToken: asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token required', 400);
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (err) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
    }

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401, 'INVALID_TOKEN');
    }

    // Check if token exists and not revoked
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const tokenResult = await query(
      `SELECT * FROM refresh_tokens 
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      throw new AppError('Refresh token expired or revoked', 401, 'TOKEN_EXPIRED');
    }

    // Revoke old token
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
      [tokenHash]
    );

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);

    // Store new refresh token
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [decoded.userId, newTokenHash, expiresAt, req.ip, req.get('User-Agent')]
    );

    res.json({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken }
    });
  }),

  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current and new password required', 400, 'VALIDATION_ERROR');
    }

    if (newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400, 'VALIDATION_ERROR');
    }

    // Verify current password
    const userResult = await query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );

    const isValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!isValid) {
      throw new AppError('Current password is incorrect', 401, 'INVALID_CREDENTIALS');
    }

    // Hash and update new password
    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    await query(
      `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
      [newHash, req.user.id]
    );

    // Revoke all refresh tokens
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user.id]
    );

    await auditService.log({
      userId: req.user.id,
      action: 'PASSWORD_CHANGE',
      entityType: 'users',
      entityId: req.user.id,
      req
    });

    res.json({ success: true, message: 'Password changed successfully' });
  }),

  getProfile: asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT id, username, email, full_name, role, agency, last_login, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        fullName: result.rows[0].full_name,
        role: result.rows[0].role,
        agency: result.rows[0].agency,
        lastLogin: result.rows[0].last_login,
        createdAt: result.rows[0].created_at
      }
    });
  })
};

module.exports = { authController };
