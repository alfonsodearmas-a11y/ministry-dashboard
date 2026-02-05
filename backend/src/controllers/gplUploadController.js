/**
 * GPL DBIS Upload Controller
 *
 * Handles the complete workflow for GPL Excel uploads:
 * 1. Parse uploaded file (preview mode)
 * 2. Display parsed data for user review
 * 3. Confirm and save to database
 * 4. Trigger AI analysis
 */

const XLSX = require('xlsx');
const path = require('path');
const { pool, query, getClient, transaction } = require('../config/database');
const { parseScheduleSheet } = require('../services/gplScheduleParser');
const { parseStatusSheet, matchOutagesToUnits } = require('../services/gplStatusParser');
const aiAnalysisService = require('../services/aiAnalysisService');

/**
 * POST /api/gpl/upload
 * Upload and parse GPL DBIS Excel file (preview mode)
 */
async function uploadAndPreview(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const filename = file.originalname;

    console.log(`[GPL Upload] Processing file: ${filename}`);

    // Parse Schedule sheet (pass buffer, parser will read workbook)
    const scheduleResult = parseScheduleSheet(file.buffer);

    if (!scheduleResult.success) {
      return res.status(400).json({
        error: 'Failed to parse Schedule sheet',
        details: scheduleResult.error,
        warnings: scheduleResult.warnings
      });
    }

    // Read workbook for status sheet parsing
    const workbook = XLSX.read(file.buffer, {
      type: 'buffer',
      cellDates: true
    });

    // Parse Generation Status sheet for outages
    const statusResult = parseStatusSheet(workbook, scheduleResult.data.date);

    // Extract parsed data
    const { data: parsedData, warnings: scheduleWarnings } = scheduleResult;

    // Match outages to units
    let enrichedOutages = [];
    if (statusResult.success && statusResult.outages.length > 0) {
      enrichedOutages = matchOutagesToUnits(statusResult.outages, parsedData.units);
    }

    // Combine warnings
    const allWarnings = [
      ...(scheduleWarnings || []).map(w => typeof w === 'string' ? w : w.message),
      ...statusResult.warnings
    ];

    // Build preview response
    const preview = {
      filename,
      fileSize: file.size,
      reportDate: parsedData.date,
      detectedDateColumn: parsedData.dateColumn,

      // Summary stats
      stats: {
        ...parsedData.stats,
        totalOutages: enrichedOutages.length
      },

      // System summary from rows 69-83 (restructure for frontend)
      summary: {
        ...parsedData.summary,
        // Add nested peak objects for frontend convenience
        eveningPeak: {
          onBars: parsedData.summary.eveningPeakOnBarsMw,
          suppressed: parsedData.summary.eveningPeakSuppressedMw
        },
        dayPeak: {
          onBars: parsedData.summary.dayPeakOnBarsMw,
          suppressed: parsedData.summary.dayPeakSuppressedMw
        },
        // Alias for frontend
        totalDBISCapacityMw: parsedData.summary.totalDbisCapacityMw
      },

      // Station-level aggregations
      stations: parsedData.stations.map(s => ({
        station: s.station,
        totalUnits: s.totalUnits,
        totalDeratedCapacityMw: s.totalDeratedCapacityMw,
        totalAvailableMw: s.totalAvailableMw,
        unitsOnline: s.unitsOnline,
        unitsOffline: s.unitsOffline,
        unitsNoData: s.unitsNoData,
        utilizationPct: s.stationUtilizationPct
      })),

      // Individual unit data
      units: parsedData.units,

      // Outage data
      outages: enrichedOutages,

      // Warnings
      warnings: allWarnings
    };

    // Store in session for confirmation
    // In production, you might use Redis or database temp storage
    req.session = req.session || {};
    req.session.gplPreview = preview;
    req.session.gplWorkbook = file.buffer; // Store for reprocessing if needed

    res.json({
      success: true,
      preview
    });

  } catch (error) {
    console.error('[GPL Upload] Error:', error);
    res.status(500).json({
      error: 'Failed to process file',
      details: error.message
    });
  }
}

/**
 * POST /api/gpl/upload/confirm
 * Confirm and save parsed data to database
 */
async function confirmUpload(req, res) {
  // pool imported at top

  try {
    const { preview, triggerAI = true } = req.body;

    if (!preview) {
      return res.status(400).json({ error: 'No preview data to confirm' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check for existing data for this date
      const existingCheck = await client.query(
        `SELECT id FROM gpl_uploads
         WHERE report_date = $1 AND status = 'confirmed'`,
        [preview.reportDate]
      );

      let replacedUploadId = null;
      if (existingCheck.rows.length > 0) {
        replacedUploadId = existingCheck.rows[0].id;
        // Delete old child records first (due to unique constraints)
        await client.query(
          `DELETE FROM gpl_daily_units WHERE upload_id = $1`,
          [replacedUploadId]
        );
        await client.query(
          `DELETE FROM gpl_daily_stations WHERE upload_id = $1`,
          [replacedUploadId]
        );
        await client.query(
          `DELETE FROM gpl_daily_summary WHERE upload_id = $1`,
          [replacedUploadId]
        );
        await client.query(
          `DELETE FROM gpl_outages WHERE upload_id = $1`,
          [replacedUploadId]
        );
        await client.query(
          `DELETE FROM gpl_ai_analysis WHERE upload_id = $1`,
          [replacedUploadId]
        );
        // Mark old upload as replaced
        await client.query(
          `UPDATE gpl_uploads SET status = 'replaced' WHERE id = $1`,
          [replacedUploadId]
        );
      }

      // 1. Insert upload record
      const uploadResult = await client.query(
        `INSERT INTO gpl_uploads (
          filename, file_size_bytes, report_date, detected_date, date_column,
          units_parsed, stations_parsed, warnings, status, replaced_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9)
        RETURNING id`,
        [
          preview.filename,
          preview.fileSize,
          preview.reportDate,
          preview.reportDate,
          preview.detectedDateColumn,
          preview.stats.totalUnits,
          preview.stats.totalStations,
          JSON.stringify(preview.warnings),
          replacedUploadId
        ]
      );

      const uploadId = uploadResult.rows[0].id;

      // 2. Insert unit records
      for (const unit of preview.units) {
        await client.query(
          `INSERT INTO gpl_daily_units (
            upload_id, report_date, row_number, station, engine, unit_number,
            installed_capacity_mva, installed_capacity_mw, derated_capacity_mw,
            available_mw, status, utilization_pct
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            uploadId,
            preview.reportDate,
            unit.rowNumber,
            unit.station,
            unit.engine,
            unit.unitNumber,
            unit.installedCapacityMva,
            unit.installedCapacityMw,
            unit.deratedCapacityMw,
            unit.availableMw,
            unit.status,
            unit.utilizationPct
          ]
        );
      }

      // 3. Insert station aggregates
      for (const station of preview.stations) {
        await client.query(
          `INSERT INTO gpl_daily_stations (
            upload_id, report_date, station,
            total_units, total_derated_capacity_mw, total_available_mw,
            units_online, units_offline, units_no_data, station_utilization_pct
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uploadId,
            preview.reportDate,
            station.station,
            station.totalUnits,
            station.totalDeratedCapacityMw,
            station.totalAvailableMw,
            station.unitsOnline,
            station.unitsOffline,
            station.unitsNoData,
            station.utilizationPct
          ]
        );
      }

      // 4. Insert summary
      const s = preview.summary;
      await client.query(
        `INSERT INTO gpl_daily_summary (
          upload_id, report_date,
          total_fossil_fuel_capacity_mw, expected_peak_demand_mw, reserve_capacity_mw,
          average_for, expected_capacity_mw, expected_reserve_mw,
          solar_hampshire_mwp, solar_prospect_mwp, solar_trafalgar_mwp, total_renewable_mwp,
          total_dbis_capacity_mw,
          evening_peak_on_bars_mw, evening_peak_suppressed_mw,
          day_peak_on_bars_mw, day_peak_suppressed_mw,
          gen_availability_at_suppressed_peak, approx_suppressed_peak,
          system_utilization_pct, reserve_margin_pct
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          uploadId,
          preview.reportDate,
          s.totalFossilFuelCapacityMw,
          s.expectedPeakDemandMw,
          s.reserveCapacityMw,
          s.averageFor,
          s.expectedCapacityMw,
          s.expectedReserveMw,
          s.solarHampshireMwp,
          s.solarProspectMwp,
          s.solarTrafalgarMwp,
          s.totalRenewableMwp,
          s.totalDbisCapacityMw,
          s.eveningPeakOnBarsMw,
          s.eveningPeakSuppressedMw,
          s.dayPeakOnBarsMw,
          s.dayPeakSuppressedMw,
          s.genAvailabilityAtSuppressedPeak,
          s.approxSuppressedPeak,
          s.systemUtilizationPct,
          s.reserveMarginPct
        ]
      );

      // 5. Insert outages
      for (const outage of preview.outages) {
        await client.query(
          `INSERT INTO gpl_outages (
            upload_id, report_date, station, engine, unit_number,
            reason, expected_completion, actual_completion, remarks, is_resolved
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uploadId,
            preview.reportDate,
            outage.station,
            outage.engine,
            outage.unitNumber,
            outage.reason,
            outage.expectedCompletion,
            outage.actualCompletion,
            outage.remarks,
            outage.isResolved
          ]
        );
      }

      await client.query('COMMIT');

      // 6. Trigger AI analysis (async, don't wait)
      if (triggerAI) {
        triggerGPLAnalysis(pool, uploadId, preview).catch(err => {
          console.error('[GPL AI Analysis] Background error:', err);
        });
      }

      res.json({
        success: true,
        uploadId,
        message: `Successfully saved GPL data for ${preview.reportDate}`,
        stats: preview.stats,
        replacedPrevious: !!replacedUploadId
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('[GPL Confirm] Error:', error);
    res.status(500).json({
      error: 'Failed to save data',
      details: error.message
    });
  }
}

/**
 * Trigger AI analysis for GPL data
 */
async function triggerGPLAnalysis(pool, uploadId, preview) {
  const client = await pool.connect();

  try {
    // Create analysis record
    const analysisResult = await client.query(
      `INSERT INTO gpl_ai_analysis (
        upload_id, report_date, analysis_model, analysis_status
      ) VALUES ($1, $2, $3, 'processing')
      RETURNING id`,
      [uploadId, preview.reportDate, 'claude-opus-4-5-20251101']
    );

    const analysisId = analysisResult.rows[0].id;
    const startTime = Date.now();

    // Build context for AI
    const analysisContext = buildAnalysisContext(preview);

    // Call AI service
    const aiResult = await aiAnalysisService.generateGPLBriefing(analysisContext);

    const processingTime = Date.now() - startTime;

    // Update analysis record
    await client.query(
      `UPDATE gpl_ai_analysis SET
        analysis_status = 'completed',
        executive_briefing = $1,
        critical_alerts = $2,
        station_concerns = $3,
        recommendations = $4,
        raw_response = $5,
        prompt_tokens = $6,
        completion_tokens = $7,
        processing_time_ms = $8,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = $9`,
      [
        aiResult.executiveBriefing,
        JSON.stringify(aiResult.criticalAlerts || []),
        JSON.stringify(aiResult.stationConcerns || []),
        JSON.stringify(aiResult.recommendations || []),
        JSON.stringify(aiResult.rawResponse),
        aiResult.usage?.promptTokens,
        aiResult.usage?.completionTokens,
        processingTime,
        analysisId
      ]
    );

    console.log(`[GPL AI Analysis] Completed in ${processingTime}ms`);

  } catch (error) {
    console.error('[GPL AI Analysis] Error:', error);

    await client.query(
      `UPDATE gpl_ai_analysis SET
        analysis_status = 'failed',
        error_message = $1
      WHERE upload_id = $2`,
      [error.message, uploadId]
    ).catch(() => {});

  } finally {
    client.release();
  }
}

/**
 * Build context object for AI analysis
 */
function buildAnalysisContext(preview) {
  const { summary, stations, outages, stats } = preview;

  // Calculate key metrics
  const offlineCapacity = stations.reduce((sum, s) =>
    sum + (s.totalDeratedCapacityMw - s.totalAvailableMw), 0);

  const criticalStations = stations.filter(s =>
    s.utilizationPct < 50 || s.unitsOffline > s.unitsOnline);

  return {
    reportDate: preview.reportDate,

    systemOverview: {
      totalCapacityMw: summary.totalFossilFuelCapacityMw,
      availableCapacityMw: summary.totalDbisCapacityMw,
      expectedPeakMw: summary.expectedPeakDemandMw,
      reserveCapacityMw: summary.reserveCapacityMw,
      reserveMarginPct: summary.reserveMarginPct,
      averageFOR: summary.averageFor,
      eveningPeak: {
        onBars: summary.eveningPeakOnBarsMw,
        suppressed: summary.eveningPeakSuppressedMw
      },
      dayPeak: {
        onBars: summary.dayPeakOnBarsMw,
        suppressed: summary.dayPeakSuppressedMw
      }
    },

    renewables: {
      hampshireMwp: summary.solarHampshireMwp,
      prospectMwp: summary.solarProspectMwp,
      trafalgarMwp: summary.solarTrafalgarMwp,
      totalMwp: summary.totalRenewableMwp
    },

    unitStats: {
      total: stats.totalUnits,
      online: stats.unitsOnline,
      offline: stats.unitsOffline,
      noData: stats.unitsNoData,
      offlineCapacityMw: offlineCapacity
    },

    stations: stations.map(s => ({
      name: s.station,
      units: s.totalUnits,
      online: s.unitsOnline,
      offline: s.unitsOffline,
      capacityMw: s.totalDeratedCapacityMw,
      availableMw: s.totalAvailableMw,
      utilizationPct: s.utilizationPct
    })),

    criticalStations: criticalStations.map(s => s.station),

    outages: outages.map(o => ({
      station: o.station,
      unit: o.unitNumber,
      reason: o.reason,
      expectedCompletion: o.expectedCompletion,
      isResolved: o.isResolved
    }))
  };
}

/**
 * GET /api/gpl/daily/:date
 * Get GPL data for a specific date
 */
async function getDailyData(req, res) {
  // pool imported at top
  const { date } = req.params;

  try {
    // Get summary
    const summaryResult = await pool.query(
      `SELECT s.*, u.filename, u.warnings
       FROM gpl_daily_summary s
       JOIN gpl_uploads u ON s.upload_id = u.id
       WHERE s.report_date = $1 AND u.status = 'confirmed'`,
      [date]
    );

    if (summaryResult.rows.length === 0) {
      return res.status(404).json({ error: 'No data found for this date' });
    }

    const summary = summaryResult.rows[0];

    // Get stations
    const stationsResult = await pool.query(
      `SELECT * FROM gpl_daily_stations
       WHERE report_date = $1
       ORDER BY station`,
      [date]
    );

    // Get units
    const unitsResult = await pool.query(
      `SELECT * FROM gpl_daily_units
       WHERE report_date = $1
       ORDER BY row_number`,
      [date]
    );

    // Get outages
    const outagesResult = await pool.query(
      `SELECT * FROM gpl_outages
       WHERE report_date = $1`,
      [date]
    );

    // Get AI analysis
    const analysisResult = await pool.query(
      `SELECT * FROM gpl_ai_analysis
       WHERE report_date = $1
       ORDER BY created_at DESC LIMIT 1`,
      [date]
    );

    res.json({
      summary,
      stations: stationsResult.rows,
      units: unitsResult.rows,
      outages: outagesResult.rows,
      analysis: analysisResult.rows[0] || null
    });

  } catch (error) {
    console.error('[GPL Daily] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/gpl/latest
 * Get the most recent GPL data
 */
async function getLatestData(req, res) {
  // pool imported at top

  try {
    const latestResult = await pool.query(
      `SELECT report_date FROM gpl_daily_summary
       ORDER BY report_date DESC LIMIT 1`
    );

    if (latestResult.rows.length === 0) {
      return res.status(404).json({ error: 'No GPL data available' });
    }

    // Redirect to the specific date endpoint
    req.params.date = latestResult.rows[0].report_date;
    return getDailyData(req, res);

  } catch (error) {
    console.error('[GPL Latest] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/gpl/history
 * Get upload history
 */
async function getUploadHistory(req, res) {
  // pool imported at top
  const limit = parseInt(req.query.limit) || 30;

  try {
    const result = await pool.query(
      `SELECT
        u.id, u.filename, u.report_date, u.status,
        u.units_parsed, u.stations_parsed, u.created_at,
        a.analysis_status, a.executive_briefing IS NOT NULL as has_analysis
       FROM gpl_uploads u
       LEFT JOIN gpl_ai_analysis a ON u.id = a.upload_id
       WHERE u.status IN ('confirmed', 'replaced')
       ORDER BY u.report_date DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('[GPL History] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/gpl/analysis/:uploadId
 * Get AI analysis for a specific upload
 */
async function getAnalysis(req, res) {
  // pool imported at top
  const { uploadId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM gpl_ai_analysis WHERE upload_id = $1`,
      [uploadId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('[GPL Analysis] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/gpl/analysis/:uploadId/retry
 * Retry AI analysis for an upload
 */
async function retryAnalysis(req, res) {
  // pool imported at top
  const { uploadId } = req.params;

  try {
    // Get the upload and its data
    const uploadResult = await pool.query(
      `SELECT * FROM gpl_uploads WHERE id = $1`,
      [uploadId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    // Get existing data to rebuild preview
    const summaryResult = await pool.query(
      `SELECT * FROM gpl_daily_summary WHERE upload_id = $1`,
      [uploadId]
    );

    const stationsResult = await pool.query(
      `SELECT * FROM gpl_daily_stations WHERE upload_id = $1`,
      [uploadId]
    );

    const unitsResult = await pool.query(
      `SELECT * FROM gpl_daily_units WHERE upload_id = $1`,
      [uploadId]
    );

    const outagesResult = await pool.query(
      `SELECT * FROM gpl_outages WHERE upload_id = $1`,
      [uploadId]
    );

    // Build preview object from database data
    const preview = {
      reportDate: uploadResult.rows[0].report_date,
      summary: summaryResult.rows[0] || {},
      stations: stationsResult.rows,
      units: unitsResult.rows,
      outages: outagesResult.rows,
      stats: {
        totalUnits: unitsResult.rows.length,
        totalStations: stationsResult.rows.length,
        unitsOnline: unitsResult.rows.filter(u => u.status === 'online').length,
        unitsOffline: unitsResult.rows.filter(u => u.status === 'offline').length,
        unitsNoData: unitsResult.rows.filter(u => u.status === 'no_data').length
      }
    };

    // Delete existing failed analysis
    await pool.query(
      `DELETE FROM gpl_ai_analysis WHERE upload_id = $1`,
      [uploadId]
    );

    // Trigger new analysis
    triggerGPLAnalysis(pool, uploadId, preview);

    res.json({
      success: true,
      message: 'AI analysis retry initiated'
    });

  } catch (error) {
    console.error('[GPL Retry Analysis] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  uploadAndPreview,
  confirmUpload,
  getDailyData,
  getLatestData,
  getUploadHistory,
  getAnalysis,
  retryAnalysis
};
