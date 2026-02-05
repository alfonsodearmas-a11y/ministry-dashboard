/**
 * GPL Forecast Controller
 *
 * API endpoints for predictive analytics and forecasting
 */

const forecasting = require('../services/gplForecasting');
const forecastAI = require('../services/gplForecastAI');
const { pool } = require('../config/database');

/**
 * Get demand forecasts
 * GET /api/v1/gpl/forecast/demand
 */
async function getDemandForecast(req, res) {
  try {
    const { months = 12 } = req.query;

    // Try to get from database first (cached)
    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_demand
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_demand)
      ORDER BY grid, projected_month
      LIMIT $1
    `, [parseInt(months) * 2]); // *2 for both grids

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows,
        cached: true
      });
    }

    // Compute fresh
    const data = await forecasting.computeDemandForecast();

    res.json({
      success: true,
      data: data.slice(0, parseInt(months) * 2),
      cached: false
    });

  } catch (err) {
    console.error('[Forecast] Demand error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get capacity timeline
 * GET /api/v1/gpl/forecast/capacity-timeline
 */
async function getCapacityTimeline(req, res) {
  try {
    // Try cached
    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_capacity
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_capacity)
      ORDER BY grid
    `);

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows,
        cached: true
      });
    }

    // Compute fresh
    const data = await forecasting.computeCapacityTimeline();

    res.json({
      success: true,
      data,
      cached: false
    });

  } catch (err) {
    console.error('[Forecast] Capacity error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get load shedding analysis
 * GET /api/v1/gpl/forecast/load-shedding
 */
async function getLoadShedding(req, res) {
  try {
    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_load_shedding
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_load_shedding)
      ORDER BY period_days DESC
      LIMIT 1
    `);

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows[0],
        cached: true
      });
    }

    const data = await forecasting.computeLoadSheddingAnalysis();

    res.json({
      success: true,
      data,
      cached: false
    });

  } catch (err) {
    console.error('[Forecast] Load shedding error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get station reliability metrics
 * GET /api/v1/gpl/forecast/stations
 */
async function getStationReliability(req, res) {
  try {
    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_station_reliability
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_station_reliability)
      ORDER BY risk_level DESC, uptime_pct ASC
    `);

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows,
        cached: true
      });
    }

    const data = await forecasting.computeStationReliability();

    res.json({
      success: true,
      data,
      cached: false
    });

  } catch (err) {
    console.error('[Forecast] Station reliability error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get units at risk
 * GET /api/v1/gpl/forecast/units-at-risk
 */
async function getUnitsAtRisk(req, res) {
  try {
    const { limit = 20 } = req.query;

    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_unit_risk
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_unit_risk)
        AND risk_level IN ('high', 'medium')
      ORDER BY risk_score DESC
      LIMIT $1
    `, [parseInt(limit)]);

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows,
        cached: true
      });
    }

    const data = await forecasting.computeUnitRisk();
    const filtered = data
      .filter(u => u.risk_level === 'high' || u.risk_level === 'medium')
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      data: filtered,
      cached: false
    });

  } catch (err) {
    console.error('[Forecast] Units at risk error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get reserve margin forecast
 * GET /api/v1/gpl/forecast/reserve
 */
async function getReserveMargin(req, res) {
  try {
    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_reserve
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_reserve)
      ORDER BY projected_month
    `);

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows,
        cached: true
      });
    }

    // Reserve margin is computed as part of capacity timeline
    // Return placeholder until full forecast runs
    res.json({
      success: true,
      data: [],
      cached: false,
      message: 'Run full forecast to generate reserve margin projections'
    });

  } catch (err) {
    console.error('[Forecast] Reserve margin error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get Essequibo grid outlook
 * GET /api/v1/gpl/forecast/essequibo
 */
async function getEssequiboOutlook(req, res) {
  try {
    // Get Essequibo-specific data from forecasts
    const demandResult = await pool.query(`
      SELECT * FROM gpl_forecast_demand
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_demand)
        AND grid = 'Essequibo'
      ORDER BY projected_month
      LIMIT 12
    `);

    const capacityResult = await pool.query(`
      SELECT * FROM gpl_forecast_capacity
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_capacity)
        AND grid = 'Essequibo'
    `);

    res.json({
      success: true,
      data: {
        demand: demandResult.rows,
        capacity: capacityResult.rows[0] || null
      }
    });

  } catch (err) {
    console.error('[Forecast] Essequibo error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get KPI trend forecasts
 * GET /api/v1/gpl/forecast/kpi-trends
 */
async function getKpiTrends(req, res) {
  try {
    const cached = await pool.query(`
      SELECT * FROM gpl_forecast_kpi
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_kpi)
      ORDER BY kpi_name, projected_month
    `);

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        data: cached.rows,
        cached: true
      });
    }

    const data = await forecasting.computeKpiForecasts();

    res.json({
      success: true,
      data,
      cached: false
    });

  } catch (err) {
    console.error('[Forecast] KPI trends error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get latest AI strategic briefing
 * GET /api/v1/gpl/forecast/briefing
 */
async function getBriefing(req, res) {
  try {
    const briefing = await forecastAI.getLatestBriefing();

    if (!briefing) {
      return res.json({
        success: true,
        data: null,
        message: 'No briefing available. Run forecast refresh to generate.'
      });
    }

    res.json({
      success: true,
      data: {
        id: briefing.id,
        analysisType: briefing.analysis_type,
        dataThroughDate: briefing.data_through_date,
        dailyDataPoints: briefing.daily_data_points,
        monthlyDataPoints: briefing.monthly_data_points,
        executiveBriefing: briefing.executive_briefing,
        sections: {
          demandOutlook: briefing.demand_outlook,
          capacityRisk: briefing.capacity_risk,
          infrastructureReliability: briefing.infrastructure_reliability,
          customerRevenueImpact: briefing.customer_revenue_impact,
          essequiboAssessment: briefing.essequibo_assessment,
          recommendations: briefing.recommendations
        },
        usage: {
          promptTokens: briefing.prompt_tokens,
          completionTokens: briefing.completion_tokens
        },
        processingTimeMs: briefing.processing_time_ms,
        generatedAt: briefing.generated_at
      }
    });

  } catch (err) {
    console.error('[Forecast] Briefing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Refresh all forecasts
 * POST /api/v1/gpl/forecast/refresh
 */
async function refreshForecasts(req, res) {
  try {
    const { includeAI = true } = req.body;

    console.log('[Forecast] Starting forecast refresh...');

    let result;
    if (includeAI) {
      // Full analysis with AI briefing
      result = await forecastAI.runFullAnalysis();
    } else {
      // Just the forecasts without AI
      result = {
        forecasts: await forecasting.runAllForecasts(),
        ai: null
      };
    }

    res.json({
      success: true,
      data: {
        forecasts: {
          demandForecasts: result.forecasts.demandForecasts?.length || 0,
          capacityTimeline: result.forecasts.capacityTimeline?.length || 0,
          loadShedding: result.forecasts.loadShedding ? 1 : 0,
          stationReliability: result.forecasts.stationReliability?.length || 0,
          unitRisk: result.forecasts.unitRisk?.length || 0,
          kpiForecasts: result.forecasts.kpiForecasts?.length || 0
        },
        ai: result.ai ? {
          success: result.ai.success,
          processingTimeMs: result.ai.processingTimeMs,
          usage: result.ai.usage
        } : null
      },
      message: includeAI
        ? 'Forecasts and AI briefing generated successfully'
        : 'Forecasts generated successfully (AI skipped)'
    });

  } catch (err) {
    console.error('[Forecast] Refresh error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Get all forecast data in one call (for dashboard)
 * GET /api/v1/gpl/forecast/all
 */
async function getAllForecasts(req, res) {
  try {
    // Fetch all forecast data in parallel
    const [
      demandResult,
      capacityResult,
      loadSheddingResult,
      stationsResult,
      unitsResult,
      kpiResult,
      briefingResult
    ] = await Promise.all([
      pool.query(`
        SELECT * FROM gpl_forecast_demand
        WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_demand)
        ORDER BY grid, projected_month
      `),
      pool.query(`
        SELECT * FROM gpl_forecast_capacity
        WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_capacity)
        ORDER BY grid
      `),
      pool.query(`
        SELECT * FROM gpl_forecast_load_shedding
        WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_load_shedding)
        ORDER BY period_days DESC
        LIMIT 1
      `),
      pool.query(`
        SELECT * FROM gpl_forecast_station_reliability
        WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_station_reliability)
        ORDER BY risk_level DESC, uptime_pct ASC
      `),
      pool.query(`
        SELECT * FROM gpl_forecast_unit_risk
        WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_unit_risk)
          AND risk_level IN ('high', 'medium')
        ORDER BY risk_score DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT * FROM gpl_forecast_kpi
        WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_kpi)
        ORDER BY kpi_name, projected_month
      `),
      pool.query(`
        SELECT * FROM gpl_forecast_ai_analysis
        ORDER BY generated_at DESC
        LIMIT 1
      `)
    ]);

    const briefing = briefingResult.rows[0];

    res.json({
      success: true,
      data: {
        demand: demandResult.rows,
        capacity: capacityResult.rows,
        loadShedding: loadSheddingResult.rows[0] || null,
        stations: stationsResult.rows,
        unitsAtRisk: unitsResult.rows,
        kpiForecasts: kpiResult.rows,
        briefing: briefing ? {
          id: briefing.id,
          executiveBriefing: briefing.executive_briefing,
          sections: {
            demandOutlook: briefing.demand_outlook,
            capacityRisk: briefing.capacity_risk,
            infrastructureReliability: briefing.infrastructure_reliability,
            customerRevenueImpact: briefing.customer_revenue_impact,
            essequiboAssessment: briefing.essequibo_assessment,
            recommendations: briefing.recommendations
          },
          dataThroughDate: briefing.data_through_date,
          dailyDataPoints: briefing.daily_data_points,
          monthlyDataPoints: briefing.monthly_data_points,
          generatedAt: briefing.generated_at
        } : null
      },
      hasData: demandResult.rows.length > 0 || capacityResult.rows.length > 0
    });

  } catch (err) {
    console.error('[Forecast] Get all error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getDemandForecast,
  getCapacityTimeline,
  getLoadShedding,
  getStationReliability,
  getUnitsAtRisk,
  getReserveMargin,
  getEssequiboOutlook,
  getKpiTrends,
  getBriefing,
  refreshForecasts,
  getAllForecasts
};
