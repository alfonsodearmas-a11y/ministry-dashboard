/**
 * GPL Multivariate Forecast Controller
 *
 * API endpoints for scenario-based predictive analytics
 */

const multivariateForecast = require('../services/gplMultivariateForecast');

/**
 * GET /api/v1/gpl/forecast/multivariate
 * Get the latest multivariate forecast
 */
async function getMultivariateForecast(req, res) {
  try {
    const forecast = await multivariateForecast.getLatestForecast();

    if (!forecast) {
      return res.json({
        success: true,
        hasData: false,
        message: 'No forecast available. Click Refresh to generate.'
      });
    }

    res.json({
      success: true,
      hasData: true,
      forecast
    });

  } catch (err) {
    console.error('[MultiForecast Controller] Get error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve forecast',
      details: err.message
    });
  }
}

/**
 * POST /api/v1/gpl/forecast/multivariate/refresh
 * Generate a new multivariate forecast
 */
async function refreshMultivariateForecast(req, res) {
  try {
    console.log('[MultiForecast Controller] Refresh requested');

    const result = await multivariateForecast.generateForecast();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to generate forecast'
      });
    }

    res.json({
      success: true,
      forecast: result.forecast,
      warning: result.warning || null,
      message: result.warning
        ? 'Forecast generated with fallback method'
        : 'Multivariate forecast generated successfully'
    });

  } catch (err) {
    console.error('[MultiForecast Controller] Refresh error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to generate forecast',
      details: err.message
    });
  }
}

/**
 * GET /api/v1/gpl/forecast/multivariate/context
 * Get the demand context factors (for transparency)
 */
async function getDemandContext(req, res) {
  try {
    res.json({
      success: true,
      context: multivariateForecast.DEMAND_CONTEXT
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

module.exports = {
  getMultivariateForecast,
  refreshMultivariateForecast,
  getDemandContext
};
