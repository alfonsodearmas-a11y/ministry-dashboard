const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const { authenticate, authorize, authorizeAgency, requirePasswordChange } = require('../middleware/auth');
const { authController } = require('../controllers/authController');
const { metricsController } = require('../controllers/metricsController');
const { auditService } = require('../services/auditService');
const { emailService } = require('../services/emailService');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');

// ============================================
// AUTH ROUTES
// ============================================

router.post('/auth/login', authController.login);
router.post('/auth/logout', authenticate, authController.logout);
router.post('/auth/refresh', authController.refreshToken);
router.post('/auth/change-password', authenticate, authController.changePassword);
router.get('/auth/profile', authenticate, authController.getProfile);

// User Registration endpoint
router.post('/auth/register', asyncHandler(async (req, res) => {
  const { username, email, fullName, password, agency } = req.body;

  // Validation
  if (!username || !email || !fullName || !password || !agency) {
    return res.status(400).json({
      success: false,
      error: 'All fields are required: username, email, fullName, password, agency'
    });
  }

  // Validate agency
  const validAgencies = ['cjia', 'gwi', 'gpl', 'gcaa'];
  if (!validAgencies.includes(agency.toLowerCase())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid agency. Must be one of: CJIA, GWI, GPL, GCAA'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format'
    });
  }

  // Validate password strength
  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 8 characters long'
    });
  }

  // Check if username already exists
  const existingUser = await query(
    'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  if (existingUser.rows.length > 0) {
    return res.status(409).json({
      success: false,
      error: 'Username already exists'
    });
  }

  // Check if email already exists
  const existingEmail = await query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  if (existingEmail.rows.length > 0) {
    return res.status(409).json({
      success: false,
      error: 'Email already registered'
    });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

  // Create user with pending status
  const result = await query(
    'INSERT INTO users (username, email, full_name, password_hash, role, agency, status, is_active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id, username, email, full_name, role, agency, status, created_at',
    [
      username.toLowerCase(),
      email.toLowerCase(),
      fullName,
      passwordHash,
      'data_entry',
      agency.toLowerCase(),
      'pending',
      false
    ]
  );

  const newUser = result.rows[0];

  // Log the registration
  logger.info('New user registration', {
    userId: newUser.id,
    username: newUser.username,
    email: newUser.email,
    agency: newUser.agency
  });

  // Send email notification to admin
  const emailResult = await emailService.sendRegistrationNotification({
    fullName,
    email: email.toLowerCase(),
    username: username.toLowerCase(),
    agency: agency.toLowerCase()
  });

  res.status(201).json({
    success: true,
    message: 'Registration submitted successfully. Your account is pending admin approval.',
    data: {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      fullName: newUser.full_name,
      agency: newUser.agency,
      status: newUser.status
    },
    emailSent: emailResult.success
  });
}));

// Get pending registrations (admin only)
router.get('/auth/registrations/pending',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT id, username, email, full_name, agency, status, created_at FROM users WHERE status = $1 ORDER BY created_at DESC',
      ['pending']
    );
    res.json({ success: true, data: result.rows });
  })
);

// Approve or reject registration (admin only)
router.patch('/auth/registrations/:id',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be approve or reject'
      });
    }

    const userResult = await query(
      'SELECT id, username, email, full_name, status FROM users WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = userResult.rows[0];

    if (user.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'User registration is not pending'
      });
    }

    if (action === 'approve') {
      const result = await query(
        'UPDATE users SET status = $1, is_active = $2 WHERE id = $3 RETURNING id, username, email, full_name, role, agency, status, is_active',
        ['active', true, id]
      );

      await auditService.log({
        userId: req.user.id,
        action: 'APPROVE_REGISTRATION',
        entityType: 'users',
        entityId: id,
        newValues: { status: 'active', approvedBy: req.user.username },
        req
      });

      await emailService.sendApprovalNotification({
        email: user.email,
        fullName: user.full_name
      }, true);

      res.json({
        success: true,
        message: 'User registration approved',
        data: result.rows[0]
      });
    } else {
      const result = await query(
        'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, email, full_name, status',
        ['rejected', id]
      );

      await auditService.log({
        userId: req.user.id,
        action: 'REJECT_REGISTRATION',
        entityType: 'users',
        entityId: id,
        newValues: { status: 'rejected', rejectedBy: req.user.username },
        req
      });

      await emailService.sendApprovalNotification({
        email: user.email,
        fullName: user.full_name
      }, false);

      res.json({
        success: true,
        message: 'User registration rejected',
        data: result.rows[0]
      });
    }
  })
);

// ============================================
// DASHBOARD ROUTES (Public read access)
// ============================================

router.get('/dashboard', metricsController.getDashboard);
router.get('/dashboard/trends/:agency', metricsController.getTrends);

// ============================================
// METRICS SUBMISSION ROUTES
// ============================================

router.post('/metrics/cjia',
  authenticate,
  requirePasswordChange,
  authorize('data_entry', 'supervisor', 'director', 'admin'),
  authorizeAgency,
  metricsController.submitCJIA
);

router.post('/metrics/gwi',
  authenticate,
  requirePasswordChange,
  authorize('data_entry', 'supervisor', 'director', 'admin'),
  authorizeAgency,
  metricsController.submitGWI
);

router.post('/metrics/gpl',
  authenticate,
  requirePasswordChange,
  authorize('data_entry', 'supervisor', 'director', 'admin'),
  authorizeAgency,
  metricsController.submitGPL
);

// GPL DBIS Daily Report endpoint (comprehensive station-by-station entry)
router.post('/metrics/gpl/dbis',
  authenticate,
  requirePasswordChange,
  authorize('data_entry', 'supervisor', 'director', 'admin'),
  authorizeAgency,
  metricsController.submitGPLDBIS
);

// Get GPL power station configuration
router.get('/metrics/gpl/stations', metricsController.getGPLStations);

// Get GPL DBIS submission history
router.get('/metrics/gpl/dbis/history',
  authenticate,
  metricsController.getGPLDBISHistory
);

router.post('/metrics/gcaa',
  authenticate,
  requirePasswordChange,
  authorize('data_entry', 'supervisor', 'director', 'admin'),
  authorizeAgency,
  metricsController.submitGCAA
);

router.patch('/metrics/:agency/:id/status',
  authenticate,
  authorize('supervisor', 'director', 'admin'),
  metricsController.updateStatus
);

router.get('/metrics/:agency/history',
  authenticate,
  metricsController.getHistory
);

router.get('/metrics/pending',
  authenticate,
  authorize('supervisor', 'director', 'admin'),
  metricsController.getPending
);

// ============================================
// ADMIN ROUTES
// ============================================

router.get('/admin/users',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT id, username, email, full_name, role, agency, status, is_active, last_login, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, data: result.rows });
  })
);

router.post('/admin/users',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { username, email, fullName, role, agency, password } = req.body;
    const hash = await bcrypt.hash(password, 12);

    const result = await query(
      'INSERT INTO users (username, email, full_name, role, agency, password_hash, status, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, username, email, full_name, role, agency, created_at',
      [username.toLowerCase(), email.toLowerCase(), fullName, role, agency, hash, 'active', true]
    );

    await auditService.log({
      userId: req.user.id,
      action: 'CREATE_USER',
      entityType: 'users',
      entityId: result.rows[0].id,
      newValues: { username, email, fullName, role, agency },
      req
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  })
);

router.patch('/admin/users/:id',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fullName, role, agency, isActive, status } = req.body;

    const result = await query(
      'UPDATE users SET full_name = COALESCE($1, full_name), role = COALESCE($2, role), agency = COALESCE($3, agency), is_active = COALESCE($4, is_active), status = COALESCE($5, status) WHERE id = $6 RETURNING id, username, email, full_name, role, agency, status, is_active',
      [fullName, role, agency, isActive, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await auditService.log({
      userId: req.user.id,
      action: 'UPDATE_USER',
      entityType: 'users',
      entityId: id,
      newValues: req.body,
      req
    });

    res.json({ success: true, data: result.rows[0] });
  })
);

router.post('/admin/users/:id/reset-password',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const tempPassword = 'Temp@' + Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(tempPassword, 12);

    await query(
      'UPDATE users SET password_hash = $1, must_change_password = $2 WHERE id = $3',
      [hash, true, id]
    );

    await auditService.log({
      userId: req.user.id,
      action: 'RESET_PASSWORD',
      entityType: 'users',
      entityId: id,
      req
    });

    res.json({ success: true, temporaryPassword: tempPassword });
  })
);

router.get('/admin/audit-logs',
  authenticate,
  authorize('admin', 'director'),
  asyncHandler(async (req, res) => {
    const { userId, action, entityType, startDate, endDate, limit, offset } = req.query;
    const logs = await auditService.getAuditLogs({
      userId, action, entityType, startDate, endDate,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0
    });
    res.json({ success: true, data: logs });
  })
);

router.get('/alerts',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT * FROM alerts WHERE is_active = $1 AND resolved_at IS NULL ORDER BY severity DESC, created_at DESC',
      [true]
    );
    res.json({ success: true, data: result.rows });
  })
);

router.patch('/alerts/:id/acknowledge',
  authenticate,
  authorize('supervisor', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await query(
      'UPDATE alerts SET acknowledged_by = $1, acknowledged_at = NOW() WHERE id = $2 RETURNING *',
      [req.user.id, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  })
);

router.patch('/alerts/:id/resolve',
  authenticate,
  authorize('supervisor', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await query(
      'UPDATE alerts SET resolved_at = NOW(), is_active = $1 WHERE id = $2 RETURNING *',
      [false, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  })
);

module.exports = router;
