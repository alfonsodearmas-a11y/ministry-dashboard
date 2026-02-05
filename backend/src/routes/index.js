const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');

const { authenticate, authorize, authorizeAgency, requirePasswordChange } = require('../middleware/auth');
const { authController } = require('../controllers/authController');
const { metricsController } = require('../controllers/metricsController');
const { dailyUploadController } = require('../controllers/dailyUploadController');
const { auditService } = require('../services/auditService');
const { emailService } = require('../services/emailService');
const { parseGPLExcel } = require('../services/excelParser');
const gplUploadController = require('../controllers/gplUploadController');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');

// Configure multer for Excel file uploads (in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
    }
  }
});

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

// ============================================
// GPL EXCEL UPLOAD ROUTES
// ============================================

// Parse GPL Excel file (preview without saving) - NO AUTH FOR TESTING
router.post('/metrics/gpl/upload/preview',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    logger.info('GPL Excel upload preview', {
      userId: req.user?.id,
      filename: req.file.originalname,
      size: req.file.size
    });

    const result = parseGPLExcel(req.file.buffer);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to parse Excel file' });
    }

    res.json({
      success: true,
      message: 'File parsed successfully. Review the data before submitting.',
      data: result.data
    });
  })
);

// Parse and submit GPL Excel file - NO AUTH FOR TESTING
router.post('/metrics/gpl/upload/submit',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const result = parseGPLExcel(req.file.buffer);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to parse Excel file' });
    }

    const { apiPayload } = result.data;

    // Allow overrides from request body (e.g., solar data, notes)
    const payload = {
      ...apiPayload,
      hampshireSolarMwp: req.body.hampshireSolarMwp || apiPayload.hampshireSolarMwp || 0,
      prospectSolarMwp: req.body.prospectSolarMwp || apiPayload.prospectSolarMwp || 0,
      trafalgarSolarMwp: req.body.trafalgarSolarMwp || apiPayload.trafalgarSolarMwp || 0,
      notes: req.body.notes || `Uploaded from Excel: ${req.file.originalname}`,
    };

    // Inject into request body for the existing controller
    req.body = payload;

    // Call the existing DBIS submit controller
    return metricsController.submitGPLDBIS(req, res);
  })
);

// ============================================
// GPL V2 UPLOAD ROUTES (Redesigned Parser)
// ============================================

// Configure larger upload for GPL files
const gplUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for wide files
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.xlsx$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'), false);
    }
  }
});

// Upload and parse GPL DBIS Excel file (preview mode) - NO AUTH FOR TESTING
router.post('/gpl/upload',
  gplUpload.single('file'),
  asyncHandler(gplUploadController.uploadAndPreview)
);

// Confirm and save parsed GPL data - NO AUTH FOR TESTING
router.post('/gpl/upload/confirm',
  asyncHandler(gplUploadController.confirmUpload)
);

// Get GPL data for specific date - NO AUTH FOR TESTING
router.get('/gpl/daily/:date',
  asyncHandler(gplUploadController.getDailyData)
);

// Get latest GPL data - NO AUTH FOR TESTING
router.get('/gpl/latest',
  asyncHandler(gplUploadController.getLatestData)
);

// Get GPL upload history - NO AUTH FOR TESTING
router.get('/gpl/history',
  asyncHandler(gplUploadController.getUploadHistory)
);

// Get AI analysis for specific upload - NO AUTH FOR TESTING
router.get('/gpl/analysis/:uploadId',
  asyncHandler(gplUploadController.getAnalysis)
);

// Retry AI analysis - NO AUTH FOR TESTING
router.post('/gpl/analysis/:uploadId/retry',
  asyncHandler(gplUploadController.retryAnalysis)
);

// ============================================
// GPL MONTHLY KPI ROUTES
// ============================================
const gplKpiController = require('../controllers/gplKpiController');

// Configure CSV upload for KPI files
const kpiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.csv$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are allowed'), false);
    }
  }
});

// Upload and parse KPI CSV (preview mode)
router.post('/gpl/kpi/upload',
  kpiUpload.single('file'),
  asyncHandler(gplKpiController.uploadAndPreview)
);

// Confirm and save KPI data
router.post('/gpl/kpi/upload/confirm',
  asyncHandler(gplKpiController.confirmUpload)
);

// Get latest month KPIs with month-over-month change
router.get('/gpl/kpi/latest',
  asyncHandler(gplKpiController.getLatestKpis)
);

// Get trend data for charts
router.get('/gpl/kpi/trends',
  asyncHandler(gplKpiController.getTrends)
);

// Get all historical KPI data
router.get('/gpl/kpi/all',
  asyncHandler(gplKpiController.getAllKpis)
);

// Get latest AI analysis
router.get('/gpl/kpi/analysis',
  asyncHandler(gplKpiController.getAnalysis)
);

// ============================================
// GPL FORECAST ROUTES (Predictive Analytics)
// ============================================
const gplForecastController = require('../controllers/gplForecastController');

// Get all forecast data (for dashboard)
router.get('/gpl/forecast/all',
  asyncHandler(gplForecastController.getAllForecasts)
);

// Get demand forecasts
router.get('/gpl/forecast/demand',
  asyncHandler(gplForecastController.getDemandForecast)
);

// Get capacity timeline
router.get('/gpl/forecast/capacity-timeline',
  asyncHandler(gplForecastController.getCapacityTimeline)
);

// Get load shedding analysis
router.get('/gpl/forecast/load-shedding',
  asyncHandler(gplForecastController.getLoadShedding)
);

// Get station reliability metrics
router.get('/gpl/forecast/stations',
  asyncHandler(gplForecastController.getStationReliability)
);

// Get units at risk
router.get('/gpl/forecast/units-at-risk',
  asyncHandler(gplForecastController.getUnitsAtRisk)
);

// Get reserve margin forecast
router.get('/gpl/forecast/reserve',
  asyncHandler(gplForecastController.getReserveMargin)
);

// Get Essequibo grid outlook
router.get('/gpl/forecast/essequibo',
  asyncHandler(gplForecastController.getEssequiboOutlook)
);

// Get KPI trend forecasts
router.get('/gpl/forecast/kpi-trends',
  asyncHandler(gplForecastController.getKpiTrends)
);

// Get latest AI strategic briefing
router.get('/gpl/forecast/briefing',
  asyncHandler(gplForecastController.getBriefing)
);

// Refresh all forecasts (recalculate)
router.post('/gpl/forecast/refresh',
  asyncHandler(gplForecastController.refreshForecasts)
);

router.post('/metrics/gcaa',
  authenticate,
  requirePasswordChange,
  authorize('data_entry', 'supervisor', 'director', 'admin'),
  authorizeAgency,
  metricsController.submitGCAA
);

// ============================================
// DAILY EXCEL UPLOAD ROUTES (New Wide-Format Parser)
// ============================================

// Configure multer for daily Excel uploads (larger file size for wide format)
const dailyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for wide files
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.xlsx$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'), false);
    }
  }
});

// Upload Excel file for preview (parse without saving) - NO AUTH FOR TESTING
router.post('/upload/daily',
  dailyUpload.single('file'),
  asyncHandler(dailyUploadController.uploadPreview)
);

// Confirm and store the uploaded data - NO AUTH FOR TESTING
router.post('/upload/daily/confirm',
  dailyUpload.single('file'),
  asyncHandler(dailyUploadController.confirmUpload)
);

// Get stored data for a specific date - NO AUTH FOR TESTING
router.get('/upload/daily/latest',
  asyncHandler(dailyUploadController.getLatest)
);

// Get stored data for a specific date - NO AUTH FOR TESTING
router.get('/upload/daily/history',
  asyncHandler(dailyUploadController.getHistory)
);

// Get stored data for a specific date (must be after /latest and /history) - NO AUTH FOR TESTING
router.get('/upload/daily/:date',
  asyncHandler(dailyUploadController.getByDate)
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
