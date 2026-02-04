const { query } = require('../config/database');
const { logger } = require('../utils/logger');

const auditService = {
  async log({ userId, action, entityType, entityId, oldValues, newValues, req }) {
    try {
      await query(
        `INSERT INTO audit_log 
         (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          action,
          entityType,
          entityId,
          oldValues ? JSON.stringify(oldValues) : null,
          newValues ? JSON.stringify(newValues) : null,
          req?.ip || null,
          req?.get('User-Agent') || null
        ]
      );
    } catch (error) {
      logger.error('Failed to create audit log', { 
        error: error.message, 
        action, 
        entityType 
      });
    }
  },

  async getAuditLogs({ 
    userId, 
    action, 
    entityType, 
    startDate, 
    endDate, 
    limit = 100, 
    offset = 0 
  }) {
    let sql = `
      SELECT al.*, u.username, u.full_name as user_full_name
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (userId) {
      sql += ` AND al.user_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (action) {
      sql += ` AND al.action = $${paramIndex++}`;
      params.push(action);
    }

    if (entityType) {
      sql += ` AND al.entity_type = $${paramIndex++}`;
      params.push(entityType);
    }

    if (startDate) {
      sql += ` AND al.created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      sql += ` AND al.created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    sql += ` ORDER BY al.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows;
  },

  async getUserActivity(userId, days = 30) {
    const result = await query(
      `SELECT action, entity_type, COUNT(*) as count
       FROM audit_log
       WHERE user_id = $1 AND created_at >= CURRENT_DATE - $2
       GROUP BY action, entity_type
       ORDER BY count DESC`,
      [userId, days]
    );
    return result.rows;
  }
};

module.exports = { auditService };
