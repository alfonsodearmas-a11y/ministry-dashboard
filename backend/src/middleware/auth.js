const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const { AppError } = require('./errorHandler');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const token = authHeader.split(' ')[1];
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('Token expired', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
    }

    // Get user from database
    const result = await query(
      `SELECT id, username, email, full_name, role, agency, is_active, must_change_password
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 401, 'USER_NOT_FOUND');
    }

    const user = result.rows[0];

    if (!user.is_active) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      agency: user.agency,
      mustChangePassword: user.must_change_password
    };

    next();
  } catch (error) {
    next(error);
  }
};

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }

    next();
  };
};

const authorizeAgency = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  // Directors and admins can access all agencies
  if (['director', 'admin'].includes(req.user.role) || req.user.agency === 'ministry') {
    return next();
  }

  // Get requested agency from params or body
  const requestedAgency = req.params.agency || req.body.agency;
  
  if (requestedAgency && req.user.agency !== requestedAgency.toLowerCase()) {
    return next(new AppError('Access denied to this agency', 403, 'AGENCY_ACCESS_DENIED'));
  }

  next();
};

const requirePasswordChange = (req, res, next) => {
  if (req.user && req.user.mustChangePassword && req.path !== '/auth/change-password') {
    return next(new AppError('Password change required', 403, 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
};

module.exports = { authenticate, authorize, authorizeAgency, requirePasswordChange };
