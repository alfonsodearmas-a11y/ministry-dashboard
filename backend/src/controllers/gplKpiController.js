/**
 * GPL Monthly KPI Controller
 *
 * Handles CSV upload, preview, confirm, and data retrieval
 * for monthly KPI metrics.
 */

const { pool } = require('../config/database');
const { parseKpiCsv, formatForAnalysis, KNOWN_KPIS } = require('../services/gplKpiCsvParser');
const Anthropic = require('@anthropic-ai/sdk');
const forecastAI = require('../services/gplForecastAI');

// AI Configuration
const AI_CONFIG = {
  MODEL: 'claude-opus-4-5-20251101',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.3
};

/**
 * POST /api/gpl/kpi/upload
 * Upload and parse CSV file (preview mode)
 */
async function uploadAndPreview(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const filename = file.originalname;

    console.log(`[GPL KPI] Processing file: ${filename}`);

    // Parse CSV
    const result = parseKpiCsv(file.buffer, filename);

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to parse CSV',
        details: result.error,
        warnings: result.warnings
      });
    }

    // Return preview
    res.json({
      success: true,
      preview: result.preview,
      data: result.data,
      warnings: result.warnings
    });

  } catch (err) {
    console.error('[GPL KPI] Upload error:', err);
    res.status(500).json({
      error: 'Failed to process CSV file',
      details: err.message
    });
  }
}

/**
 * POST /api/gpl/kpi/upload/confirm
 * Confirm and save parsed data to database
 */
async function confirmUpload(req, res) {
  const client = await pool.connect();

  try {
    const { preview, data, triggerAI = true } = req.body;

    if (!preview || !data || data.length === 0) {
      return res.status(400).json({ error: 'No data to confirm' });
    }

    await client.query('BEGIN');

    // Create upload record
    const uploadResult = await client.query(
      `INSERT INTO gpl_kpi_uploads (
        filename, file_size_bytes, rows_parsed, date_range_start,
        date_range_end, kpis_found, warnings, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
      RETURNING id`,
      [
        preview.filename,
        0, // file size not tracked in preview
        preview.totalRows,
        preview.dateRange?.start,
        preview.dateRange?.end,
        preview.kpisFound,
        JSON.stringify(req.body.warnings || [])
      ]
    );

    const uploadId = uploadResult.rows[0].id;

    // Upsert all KPI rows
    let rowsInserted = 0;
    let rowsUpdated = 0;

    for (const row of data) {
      // Use INSERT ... ON CONFLICT for upsert
      const upsertResult = await client.query(
        `INSERT INTO gpl_monthly_kpis (
          report_month, kpi_name, value, raw_value, uploaded_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (report_month, kpi_name)
        DO UPDATE SET
          value = EXCLUDED.value,
          raw_value = EXCLUDED.raw_value,
          uploaded_at = NOW()
        RETURNING (xmax = 0) AS inserted`,
        [row.reportMonth, row.kpiName, row.value, row.rawValue]
      );

      if (upsertResult.rows[0]?.inserted) {
        rowsInserted++;
      } else {
        rowsUpdated++;
      }
    }

    // Update upload record with counts
    await client.query(
      `UPDATE gpl_kpi_uploads
       SET rows_inserted = $1, rows_updated = $2, confirmed_at = NOW()
       WHERE id = $3`,
      [rowsInserted, rowsUpdated, uploadId]
    );

    await client.query('COMMIT');

    console.log(`[GPL KPI] Saved ${rowsInserted} new, ${rowsUpdated} updated rows`);

    // Trigger AI analysis asynchronously
    if (triggerAI) {
      triggerKpiAnalysis(uploadId, data).catch(err => {
        console.error('[GPL KPI] AI analysis error:', err.message);
      });
    }

    // Trigger forecast refresh (async, don't wait)
    forecastAI.runFullAnalysis().catch(err => {
      console.error('[GPL Forecast] Background error:', err);
    });

    res.json({
      success: true,
      uploadId,
      message: `Successfully saved KPI data: ${rowsInserted} new, ${rowsUpdated} updated`,
      stats: {
        rowsInserted,
        rowsUpdated,
        totalRows: data.length,
        dateRange: preview.dateRange,
        kpisFound: preview.kpisFound
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[GPL KPI] Confirm error:', err);
    res.status(500).json({
      error: 'Failed to save KPI data',
      details: err.message
    });
  } finally {
    client.release();
  }
}

/**
 * Trigger AI analysis for KPI data
 */
async function triggerKpiAnalysis(uploadId, data) {
  const client = await pool.connect();

  try {
    // Format data for analysis
    const analysisData = formatForAnalysis(data);

    // Create analysis record
    const analysisResult = await client.query(
      `INSERT INTO gpl_kpi_ai_analysis (
        upload_id, analysis_date, date_range_start, date_range_end,
        analysis_model, analysis_status
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, 'processing')
      RETURNING id`,
      [uploadId, analysisData.dateRange.start, analysisData.dateRange.end, AI_CONFIG.MODEL]
    );

    const analysisId = analysisResult.rows[0].id;

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      await client.query(
        `UPDATE gpl_kpi_ai_analysis
         SET analysis_status = 'failed',
             error_message = 'ANTHROPIC_API_KEY not configured',
             completed_at = NOW()
         WHERE id = $1`,
        [analysisId]
      );
      return;
    }

    const startTime = Date.now();

    // Build prompt
    const prompt = buildKpiAnalysisPrompt(analysisData);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: AI_CONFIG.MODEL,
      max_tokens: AI_CONFIG.MAX_TOKENS,
      temperature: AI_CONFIG.TEMPERATURE,
      messages: [{ role: 'user', content: prompt }]
    });

    const processingTime = Date.now() - startTime;

    // Extract response text
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse structured response
    let keyFindings = null;
    let concerningTrends = null;

    try {
      // Try to extract JSON if present
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        keyFindings = parsed.keyFindings || parsed.key_findings;
        concerningTrends = parsed.concerningTrends || parsed.concerning_trends;
      }
    } catch (parseErr) {
      // JSON parsing failed, just use raw text
    }

    // Update analysis record
    await client.query(
      `UPDATE gpl_kpi_ai_analysis
       SET analysis_status = 'completed',
           executive_briefing = $1,
           key_findings = $2,
           concerning_trends = $3,
           raw_response = $4,
           prompt_tokens = $5,
           completion_tokens = $6,
           processing_time_ms = $7,
           completed_at = NOW()
       WHERE id = $8`,
      [
        responseText,
        JSON.stringify(keyFindings),
        JSON.stringify(concerningTrends),
        JSON.stringify(response),
        response.usage?.input_tokens,
        response.usage?.output_tokens,
        processingTime,
        analysisId
      ]
    );

    console.log(`[GPL KPI] AI analysis completed in ${processingTime}ms`);

  } catch (err) {
    console.error('[GPL KPI] AI analysis failed:', err);

    // Update with error
    await client.query(
      `UPDATE gpl_kpi_ai_analysis
       SET analysis_status = 'failed',
           error_message = $1,
           completed_at = NOW()
       WHERE upload_id = $2 AND analysis_status = 'processing'`,
      [err.message, uploadId]
    ).catch(() => {});

  } finally {
    client.release();
  }
}

/**
 * Build prompt for KPI analysis
 */
function buildKpiAnalysisPrompt(analysisData) {
  return `You are the Director General's briefing analyst for GPL (Guyana Power & Light). Analyze the monthly KPI data spanning ${analysisData.dateRange.start} to ${analysisData.dateRange.end}.

${analysisData.text}

Focus your analysis on:

1. **Peak Demand Trends** - Growth rate for DBIS and Essequibo grids, seasonal patterns, month-over-month changes
2. **Capacity Adequacy** - Is installed capacity keeping pace with demand growth? What's the reserve margin trend?
3. **Generation Mix** - Shifts between HFO (Heavy Fuel Oil) and LFO (Light Fuel Oil) percentages
4. **Customer Impact** - Affected customers trend, identify any months with spikes and possible causes
5. **Collection Rate Performance** - Performance against the 95% target, identify concerning months

Provide a 3-paragraph executive briefing with specific numbers and month-over-month comparisons. Be direct and actionable.

In your final paragraph, flag any concerning trends that need the Director General's immediate attention.

Format your response as plain text paragraphs (not JSON). Include specific numbers and percentages to support your analysis.`;
}

/**
 * GET /api/gpl/kpi/latest
 * Get most recent month's KPIs with month-over-month change
 */
async function getLatestKpis(req, res) {
  try {
    // Get the two most recent months
    const result = await pool.query(`
      WITH recent_months AS (
        SELECT DISTINCT report_month
        FROM gpl_monthly_kpis
        ORDER BY report_month DESC
        LIMIT 2
      ),
      latest AS (
        SELECT report_month, kpi_name, value
        FROM gpl_monthly_kpis
        WHERE report_month = (SELECT MAX(report_month) FROM recent_months)
      ),
      previous AS (
        SELECT report_month, kpi_name, value
        FROM gpl_monthly_kpis
        WHERE report_month = (SELECT MIN(report_month) FROM recent_months)
      )
      SELECT
        l.report_month,
        l.kpi_name,
        l.value AS current_value,
        p.value AS previous_value,
        CASE
          WHEN p.value IS NOT NULL AND p.value != 0
          THEN ROUND(((l.value - p.value) / p.value * 100)::numeric, 2)
          ELSE NULL
        END AS change_pct
      FROM latest l
      LEFT JOIN previous p ON l.kpi_name = p.kpi_name
      ORDER BY l.kpi_name
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        hasData: false,
        message: 'No KPI data available'
      });
    }

    const latestMonth = result.rows[0]?.report_month;

    // Build response object
    const kpis = {};
    result.rows.forEach(row => {
      kpis[row.kpi_name] = {
        value: parseFloat(row.current_value),
        previousValue: row.previous_value ? parseFloat(row.previous_value) : null,
        changePct: row.change_pct ? parseFloat(row.change_pct) : null
      };
    });

    res.json({
      success: true,
      hasData: true,
      reportMonth: latestMonth,
      kpis
    });

  } catch (err) {
    console.error('[GPL KPI] Get latest error:', err);
    res.status(500).json({
      error: 'Failed to fetch latest KPIs',
      details: err.message
    });
  }
}

/**
 * GET /api/gpl/kpi/trends
 * Get trend data for charts
 */
async function getTrends(req, res) {
  try {
    const months = parseInt(req.query.months) || 24;

    const result = await pool.query(`
      SELECT report_month, kpi_name, value
      FROM gpl_monthly_kpis
      WHERE report_month >= (
        SELECT MAX(report_month) - INTERVAL '${months} months'
        FROM gpl_monthly_kpis
      )
      ORDER BY report_month ASC, kpi_name
    `);

    // Group by month
    const byMonth = {};
    result.rows.forEach(row => {
      const month = row.report_month.toISOString().split('T')[0];
      if (!byMonth[month]) {
        byMonth[month] = { month };
      }
      byMonth[month][row.kpi_name] = row.value ? parseFloat(row.value) : null;
    });

    const trends = Object.values(byMonth).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    res.json({
      success: true,
      months: trends.length,
      trends
    });

  } catch (err) {
    console.error('[GPL KPI] Get trends error:', err);
    res.status(500).json({
      error: 'Failed to fetch trends',
      details: err.message
    });
  }
}

/**
 * GET /api/gpl/kpi/all
 * Get all historical KPI data
 */
async function getAllKpis(req, res) {
  try {
    const result = await pool.query(`
      SELECT report_month, kpi_name, value, raw_value, uploaded_at
      FROM gpl_monthly_kpis
      ORDER BY report_month DESC, kpi_name
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (err) {
    console.error('[GPL KPI] Get all error:', err);
    res.status(500).json({
      error: 'Failed to fetch KPI data',
      details: err.message
    });
  }
}

/**
 * GET /api/gpl/kpi/analysis
 * Get latest AI analysis
 */
async function getAnalysis(req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM gpl_kpi_ai_analysis
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        hasAnalysis: false,
        message: 'No AI analysis available. Upload KPI data to generate analysis.'
      });
    }

    res.json({
      success: true,
      hasAnalysis: true,
      analysis: result.rows[0]
    });

  } catch (err) {
    console.error('[GPL KPI] Get analysis error:', err);
    res.status(500).json({
      error: 'Failed to fetch analysis',
      details: err.message
    });
  }
}

module.exports = {
  uploadAndPreview,
  confirmUpload,
  getLatestKpis,
  getTrends,
  getAllKpis,
  getAnalysis
};
