const { query, transaction } = require('../config/database');
const { parseDailyExcel, validateExcelFile, getYesterdayGuyana } = require('../services/dailyExcelParser');
const { analyzeMetrics } = require('../services/aiAnalysisService');
const { auditService } = require('../services/auditService');
const { logger } = require('../utils/logger');

/**
 * Daily Upload Controller
 *
 * Handles the daily Excel upload workflow:
 * 1. Upload & preview - parse file, detect date, return preview
 * 2. Confirm - store data, trigger AI analysis
 * 3. Retrieve - get stored data and analysis by date
 */

const dailyUploadController = {
  /**
   * POST /api/upload/daily
   * Upload Excel file for preview (does not save to DB)
   */
  uploadPreview: async (req, res) => {
    const startTime = Date.now();

    try {
      // Validate file
      const validation = validateExcelFile(req.file);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      // Log upload attempt
      logger.info('Daily Excel upload preview started', {
        userId: req.user?.id || 'anonymous',
        filename: req.file.originalname,
        size: req.file.size
      });

      // Parse the Excel file
      const parseResult = parseDailyExcel(req.file.buffer);

      if (!parseResult.success) {
        logger.warn('Daily Excel parsing failed', {
          error: parseResult.error,
          filename: req.file.originalname
        });

        return res.status(400).json({
          success: false,
          error: parseResult.error,
          details: parseResult.details
        });
      }

      const { data, warnings } = parseResult;

      // Check if data already exists for this date
      const existingUpload = await query(
        `SELECT id, filename, created_at, uploaded_by
         FROM daily_uploads
         WHERE data_date = $1 AND status = 'confirmed'
         ORDER BY created_at DESC
         LIMIT 1`,
        [data.date]
      );

      let duplicateWarning = null;
      if (existingUpload.rows.length > 0) {
        const existing = existingUpload.rows[0];
        duplicateWarning = {
          type: 'DUPLICATE_DATE',
          message: `Data for ${data.date} already exists. Confirming will replace the existing data.`,
          existingUpload: {
            id: existing.id,
            filename: existing.filename,
            uploadedAt: existing.created_at
          }
        };
      }

      const processingTime = Date.now() - startTime;

      // Log successful preview
      logger.info('Daily Excel preview completed', {
        userId: req.user?.id || 'anonymous',
        filename: req.file.originalname,
        date: data.date,
        recordCount: data.records.length,
        exactDateMatch: data.exactDateMatch,
        processingTimeMs: processingTime
      });

      res.json({
        success: true,
        message: 'File parsed successfully. Review the data before confirming.',
        data: {
          date: data.date,
          expectedDate: data.expectedDate,
          exactDateMatch: data.exactDateMatch,
          dateColumn: data.dateColumn,
          recordCount: data.records.length,
          stats: data.stats,
          records: data.records,
          metadata: data.metadata
        },
        warnings: [
          ...(warnings || []),
          ...(duplicateWarning ? [duplicateWarning] : [])
        ],
        processingTimeMs: processingTime
      });

    } catch (error) {
      logger.error('Daily upload preview error', {
        error: error.message,
        stack: error.stack,
        filename: req.file?.originalname
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error during file processing'
      });
    }
  },

  /**
   * POST /api/upload/daily/confirm
   * Confirm and store the uploaded data, trigger AI analysis
   */
  confirmUpload: async (req, res) => {
    const startTime = Date.now();

    try {
      // Validate file
      const validation = validateExcelFile(req.file);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      // Parse the Excel file again
      const parseResult = parseDailyExcel(req.file.buffer);

      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: parseResult.error
        });
      }

      const { data, warnings } = parseResult;
      const { overwrite } = req.body;

      // Get user ID or use admin as default for testing
      const userId = req.user?.id || 'a3e6da87-35b0-4342-8679-63ab04b58113'; // admin user ID

      logger.info('Daily upload confirmation started', {
        userId,
        date: data.date,
        recordCount: data.records.length,
        overwrite
      });

      // Use transaction for data consistency
      const result = await transaction(async (client) => {
        // Check for existing data
        const existingResult = await client.query(
          `SELECT id FROM daily_uploads
           WHERE data_date = $1 AND status = 'confirmed'
           ORDER BY created_at DESC
           LIMIT 1`,
          [data.date]
        );

        let replacedUploadId = null;

        if (existingResult.rows.length > 0) {
          if (!overwrite) {
            // Return warning without committing
            return {
              requiresOverwrite: true,
              existingId: existingResult.rows[0].id
            };
          }

          // Mark existing upload as replaced
          replacedUploadId = existingResult.rows[0].id;
          await client.query(
            `UPDATE daily_uploads SET status = 'replaced', updated_at = NOW()
             WHERE id = $1`,
            [replacedUploadId]
          );
        }

        // Create upload record
        const uploadResult = await client.query(
          `INSERT INTO daily_uploads (
            filename, file_size_bytes, data_date, detected_date,
            date_match_exact, row_count, error_count, warning_count,
            status, warnings, uploaded_by, replaced_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id`,
          [
            req.file.originalname,
            req.file.size,
            data.date,
            data.date,
            data.exactDateMatch,
            data.records.length,
            data.stats.errors,
            (warnings || []).length,
            'confirmed',
            JSON.stringify(warnings || []),
            userId,
            replacedUploadId
          ]
        );

        const uploadId = uploadResult.rows[0].id;

        // Update the replaced upload to reference this one
        if (replacedUploadId) {
          await client.query(
            `UPDATE daily_uploads SET replaced_by = $1 WHERE id = $2`,
            [uploadId, replacedUploadId]
          );
        }

        // Insert metrics records
        for (const record of data.records) {
          await client.query(
            `INSERT INTO daily_metrics (
              upload_id, data_date, row_number, metric_name,
              category, subcategory, agency, unit,
              raw_value, numeric_value, value_type,
              has_error, error_detail, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (data_date, row_number, metric_name)
            DO UPDATE SET
              upload_id = EXCLUDED.upload_id,
              category = EXCLUDED.category,
              subcategory = EXCLUDED.subcategory,
              agency = EXCLUDED.agency,
              unit = EXCLUDED.unit,
              raw_value = EXCLUDED.raw_value,
              numeric_value = EXCLUDED.numeric_value,
              value_type = EXCLUDED.value_type,
              has_error = EXCLUDED.has_error,
              error_detail = EXCLUDED.error_detail,
              metadata = EXCLUDED.metadata`,
            [
              uploadId,
              data.date,
              record.row,
              record.metric_name,
              record.category,
              record.subcategory,
              record.agency,
              record.unit,
              record.raw_value?.toString(),
              record.numeric_value,
              record.value_type,
              record.has_error,
              record.error_detail,
              JSON.stringify({})
            ]
          );
        }

        return { uploadId, replacedUploadId };
      });

      // Check if overwrite is required
      if (result.requiresOverwrite) {
        return res.status(409).json({
          success: false,
          error: 'Data already exists for this date',
          requiresOverwrite: true,
          existingUploadId: result.existingId,
          message: 'Set overwrite=true in request body to replace existing data'
        });
      }

      const { uploadId, replacedUploadId } = result;

      // Log the upload
      await auditService.log({
        userId: userId,
        action: replacedUploadId ? 'DAILY_UPLOAD_REPLACE' : 'DAILY_UPLOAD_CONFIRM',
        entityType: 'daily_uploads',
        entityId: uploadId,
        newValues: {
          filename: req.file.originalname,
          date: data.date,
          recordCount: data.records.length,
          replacedUploadId
        },
        req
      });

      // Trigger AI analysis asynchronously
      let analysisResult = null;
      try {
        analysisResult = await analyzeMetrics(data.records, data.date);

        if (analysisResult.success) {
          // Store analysis in database
          await query(
            `INSERT INTO daily_analysis (
              upload_id, data_date, analysis_model, analysis_status,
              executive_summary, anomalies, attention_items, agency_summaries,
              prompt_tokens, completion_tokens, processing_time_ms, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
            [
              uploadId,
              data.date,
              analysisResult.meta.model,
              'completed',
              analysisResult.analysis.executive_summary,
              JSON.stringify(analysisResult.analysis.anomalies),
              JSON.stringify(analysisResult.analysis.attention_items),
              JSON.stringify(analysisResult.analysis.agency_summaries),
              analysisResult.meta.promptTokens,
              analysisResult.meta.completionTokens,
              analysisResult.meta.processingTimeMs
            ]
          );

          logger.info('AI analysis stored', { uploadId, date: data.date });
        } else {
          // Store failed analysis
          await query(
            `INSERT INTO daily_analysis (
              upload_id, data_date, analysis_model, analysis_status, error_message
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              uploadId,
              data.date,
              'claude-opus-4-5-20251101',
              'failed',
              analysisResult.error
            ]
          );

          logger.warn('AI analysis failed but upload succeeded', {
            uploadId,
            error: analysisResult.error
          });
        }
      } catch (analysisError) {
        logger.error('AI analysis error', {
          uploadId,
          error: analysisError.message
        });

        // Don't fail the upload if analysis fails
        await query(
          `INSERT INTO daily_analysis (
            upload_id, data_date, analysis_model, analysis_status, error_message
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            uploadId,
            data.date,
            'claude-opus-4-5-20251101',
            'failed',
            analysisError.message
          ]
        );
      }

      const processingTime = Date.now() - startTime;

      logger.info('Daily upload confirmed', {
        uploadId,
        date: data.date,
        recordCount: data.records.length,
        replaced: !!replacedUploadId,
        analysisSuccess: analysisResult?.success,
        processingTimeMs: processingTime
      });

      res.status(201).json({
        success: true,
        message: replacedUploadId
          ? 'Data uploaded and replaced existing data successfully'
          : 'Data uploaded successfully',
        data: {
          uploadId,
          date: data.date,
          recordCount: data.records.length,
          stats: data.stats,
          replaced: !!replacedUploadId,
          replacedUploadId
        },
        analysis: analysisResult?.success ? {
          status: 'completed',
          executive_summary: analysisResult.analysis.executive_summary,
          anomalies: analysisResult.analysis.anomalies,
          attention_items: analysisResult.analysis.attention_items,
          agency_summaries: analysisResult.analysis.agency_summaries
        } : {
          status: 'failed',
          error: analysisResult?.error || 'Analysis not available'
        },
        warnings,
        processingTimeMs: processingTime
      });

    } catch (error) {
      logger.error('Daily upload confirmation error', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error during upload confirmation'
      });
    }
  },

  /**
   * GET /api/upload/daily/:date
   * Get stored data and analysis for a specific date
   */
  getByDate: async (req, res) => {
    try {
      const { date } = req.params;

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Get upload record
      const uploadResult = await query(
        `SELECT u.*, usr.full_name AS uploaded_by_name
         FROM daily_uploads u
         JOIN users usr ON u.uploaded_by = usr.id
         WHERE u.data_date = $1 AND u.status = 'confirmed'
         ORDER BY u.created_at DESC
         LIMIT 1`,
        [date]
      );

      if (uploadResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `No data found for date: ${date}`
        });
      }

      const upload = uploadResult.rows[0];

      // Get metrics
      const metricsResult = await query(
        `SELECT * FROM daily_metrics
         WHERE upload_id = $1
         ORDER BY row_number`,
        [upload.id]
      );

      // Get analysis
      const analysisResult = await query(
        `SELECT * FROM daily_analysis
         WHERE upload_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [upload.id]
      );

      const analysis = analysisResult.rows[0] || null;

      res.json({
        success: true,
        data: {
          upload: {
            id: upload.id,
            filename: upload.filename,
            dataDate: upload.data_date,
            rowCount: upload.row_count,
            status: upload.status,
            uploadedBy: upload.uploaded_by_name,
            uploadedAt: upload.created_at,
            warnings: upload.warnings
          },
          metrics: metricsResult.rows,
          analysis: analysis ? {
            status: analysis.analysis_status,
            executive_summary: analysis.executive_summary,
            anomalies: analysis.anomalies,
            attention_items: analysis.attention_items,
            agency_summaries: analysis.agency_summaries,
            completedAt: analysis.completed_at
          } : null
        }
      });

    } catch (error) {
      logger.error('Get daily data error', {
        error: error.message,
        date: req.params.date
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  /**
   * GET /api/upload/daily/latest
   * Get the most recent upload data and analysis
   */
  getLatest: async (req, res) => {
    try {
      // Get latest upload
      const uploadResult = await query(
        `SELECT u.*, usr.full_name AS uploaded_by_name
         FROM daily_uploads u
         JOIN users usr ON u.uploaded_by = usr.id
         WHERE u.status = 'confirmed'
         ORDER BY u.data_date DESC, u.created_at DESC
         LIMIT 1`
      );

      if (uploadResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No uploads found'
        });
      }

      const upload = uploadResult.rows[0];

      // Get metrics
      const metricsResult = await query(
        `SELECT * FROM daily_metrics
         WHERE upload_id = $1
         ORDER BY row_number`,
        [upload.id]
      );

      // Get analysis
      const analysisResult = await query(
        `SELECT * FROM daily_analysis
         WHERE upload_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [upload.id]
      );

      const analysis = analysisResult.rows[0] || null;

      res.json({
        success: true,
        data: {
          upload: {
            id: upload.id,
            filename: upload.filename,
            dataDate: upload.data_date,
            rowCount: upload.row_count,
            status: upload.status,
            uploadedBy: upload.uploaded_by_name,
            uploadedAt: upload.created_at,
            warnings: upload.warnings
          },
          metrics: metricsResult.rows,
          analysis: analysis ? {
            status: analysis.analysis_status,
            executive_summary: analysis.executive_summary,
            anomalies: analysis.anomalies,
            attention_items: analysis.attention_items,
            agency_summaries: analysis.agency_summaries,
            completedAt: analysis.completed_at
          } : null
        }
      });

    } catch (error) {
      logger.error('Get latest daily data error', { error: error.message });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  /**
   * GET /api/upload/daily/history
   * Get upload history with pagination
   */
  getHistory: async (req, res) => {
    try {
      const { limit = 20, offset = 0 } = req.query;

      const result = await query(
        `SELECT
          u.id,
          u.filename,
          u.data_date,
          u.row_count,
          u.status,
          u.created_at,
          usr.full_name AS uploaded_by_name,
          a.analysis_status,
          a.executive_summary
         FROM daily_uploads u
         JOIN users usr ON u.uploaded_by = usr.id
         LEFT JOIN daily_analysis a ON u.id = a.upload_id
         WHERE u.status IN ('confirmed', 'replaced')
         ORDER BY u.data_date DESC, u.created_at DESC
         LIMIT $1 OFFSET $2`,
        [parseInt(limit), parseInt(offset)]
      );

      const countResult = await query(
        `SELECT COUNT(*) FROM daily_uploads WHERE status IN ('confirmed', 'replaced')`
      );

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });

    } catch (error) {
      logger.error('Get upload history error', { error: error.message });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
};

module.exports = { dailyUploadController };
