/**
 * GPL Multivariate Forecast Service
 *
 * Sophisticated scenario-based forecasting using Claude Opus for analytical reasoning.
 * Produces Conservative and Aggressive scenarios with transparent methodology.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../config/database');

// Claude Opus configuration
const AI_CONFIG = {
  MODEL: 'claude-opus-4-5-20251101',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.2
};

// Hardcoded contextual factors for Guyana's energy demand
const DEMAND_CONTEXT = {
  economic: {
    gdpGrowth2024: 33, // Percent, driven by oil & gas
    populationGrowthRate: 0.5, // Percent annually
    oilProduction: 'Stabroek Block ramping up production, multiple FPSOs operational',
    gasToEnergy: 'Gas-to-energy project expected to add 300+ MW by 2025-2026'
  },
  commercial: {
    georgetownCorridor: 'Active construction: hotels, malls, office buildings',
    industrialParks: 'Shore bases, processing facilities expanding',
    tourism: 'Growing tourism sector increasing hospitality load'
  },
  residential: {
    housingPrograms: 'Government housing programs adding residential load',
    subdivisions: 'New residential subdivisions in Greater Georgetown area'
  },
  seasonal: {
    drySeasonPeak: 'September-November: higher cooling loads',
    wetSeason: 'May-August: slightly reduced cooling demand',
    note: 'Guyana is tropical with relatively stable temperatures year-round'
  },
  supply: {
    currentSolar: '10 MWp installed (daytime only, ~5% of peak)',
    plannedCapacity: 'Solar expansion, gas-to-energy project',
    interconnection: 'DBIS and Essequibo grids remain separate'
  },
  emerging: {
    evAdoption: 'Minimal currently but potential growth at 24mo+ horizon',
    datacenters: 'Potential for regional data center development',
    manufacturing: 'Light manufacturing growth tied to oil services'
  }
};

/**
 * Assemble all historical data for Claude analysis
 */
async function assembleHistoricalData() {
  try {
    // Get monthly KPI trends (last 24 months if available)
    const kpiResult = await pool.query(`
      SELECT report_month, kpi_name, value
      FROM gpl_monthly_kpis
      ORDER BY report_month ASC, kpi_name
    `);

    // Group KPIs by month
    const monthlyData = {};
    kpiResult.rows.forEach(row => {
      const month = row.report_month.toISOString().split('T')[0].slice(0, 7);
      if (!monthlyData[month]) monthlyData[month] = {};
      monthlyData[month][row.kpi_name] = parseFloat(row.value);
    });

    // Get latest daily summary for current state
    const dailyResult = await pool.query(`
      SELECT *
      FROM gpl_daily_summary
      ORDER BY report_date DESC
      LIMIT 1
    `);
    const latestDaily = dailyResult.rows[0] || null;

    // Get station reliability data
    const stationResult = await pool.query(`
      SELECT
        station,
        AVG(station_utilization_pct) as avg_utilization,
        COUNT(CASE WHEN units_offline > 0 THEN 1 END) as days_with_outages,
        COUNT(*) as total_days
      FROM gpl_daily_stations
      WHERE report_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY station
      ORDER BY station
    `);

    // Get capacity data
    const capacityResult = await pool.query(`
      SELECT
        grid,
        current_capacity_mw,
        reserve_margin_pct
      FROM gpl_forecast_capacity
      WHERE forecast_date = (SELECT MAX(forecast_date) FROM gpl_forecast_capacity)
    `);

    // Format monthly data as a clean table
    const months = Object.keys(monthlyData).sort();
    const formattedTable = months.map(month => {
      const d = monthlyData[month];
      return {
        month,
        peakDemandDBIS: d['Peak Demand DBIS'] || null,
        peakDemandEssequibo: d['Peak Demand Essequibo'] || null,
        installedCapacityDBIS: d['Installed Capacity DBIS'] || null,
        installedCapacityEssequibo: d['Installed Capacity Essequibo'] || null,
        collectionRate: d['Collection Rate %'] || null,
        affectedCustomers: d['Affected Customers'] || null,
        hfoMix: d['HFO Generation Mix %'] || null,
        lfoMix: d['LFO Generation Mix %'] || null
      };
    });

    return {
      monthlyKPIs: formattedTable,
      latestDaily,
      stationReliability: stationResult.rows,
      capacityData: capacityResult.rows,
      dataRange: {
        start: months[0] || 'N/A',
        end: months[months.length - 1] || 'N/A',
        monthsAvailable: months.length
      }
    };
  } catch (err) {
    console.error('[MultiForecast] Data assembly error:', err);
    throw err;
  }
}

/**
 * Build the Claude prompt with assembled data
 */
function buildForecastPrompt(historicalData) {
  // Format monthly data as readable table
  const tableRows = historicalData.monthlyKPIs.map(m =>
    `${m.month} | ${m.peakDemandDBIS?.toFixed(1) || '-'} | ${m.peakDemandEssequibo?.toFixed(1) || '-'} | ${m.installedCapacityDBIS?.toFixed(1) || '-'} | ${m.collectionRate?.toFixed(1) || '-'}% | ${m.affectedCustomers?.toLocaleString() || '-'}`
  ).join('\n');

  // Current system state
  const dbisCapacity = historicalData.capacityData.find(c => c.grid === 'DBIS');
  const esqCapacity = historicalData.capacityData.find(c => c.grid === 'Essequibo');

  const latestDBIS = historicalData.monthlyKPIs.slice(-1)[0]?.peakDemandDBIS || 200;
  const latestEsq = historicalData.monthlyKPIs.slice(-1)[0]?.peakDemandEssequibo || 13;

  return `You are an energy systems analyst providing a demand forecast briefing for the Director General of the Ministry of Public Utilities in Guyana.

HISTORICAL DATA (Monthly KPIs):
Month | DBIS Peak (MW) | Esq Peak (MW) | DBIS Capacity (MW) | Collection Rate | Affected Customers
${tableRows}

CURRENT SYSTEM STATE:
- DBIS Grid: ${dbisCapacity?.current_capacity_mw || 230} MW installed capacity, ${dbisCapacity?.reserve_margin_pct || 12}% reserve margin
- Essequibo Grid: ${esqCapacity?.current_capacity_mw || 36} MW installed capacity, ${esqCapacity?.reserve_margin_pct || 40}% reserve margin
- Latest DBIS Peak Demand: ${latestDBIS} MW
- Latest Essequibo Peak Demand: ${latestEsq} MW
- Data period: ${historicalData.dataRange.start} to ${historicalData.dataRange.end} (${historicalData.dataRange.monthsAvailable} months)

KNOWN DEMAND DRIVERS:
1. ECONOMIC: Guyana's GDP grew ~${DEMAND_CONTEXT.economic.gdpGrowth2024}% in 2024, driven by oil & gas production (Stabroek Block). Population growth ~${DEMAND_CONTEXT.economic.populationGrowthRate}% annually.
2. COMMERCIAL: ${DEMAND_CONTEXT.commercial.georgetownCorridor}. ${DEMAND_CONTEXT.commercial.industrialParks}.
3. RESIDENTIAL: ${DEMAND_CONTEXT.residential.housingPrograms}. ${DEMAND_CONTEXT.residential.subdivisions}.
4. SEASONAL: ${DEMAND_CONTEXT.seasonal.drySeasonPeak}. ${DEMAND_CONTEXT.seasonal.wetSeason}.
5. SUPPLY SIDE: ${DEMAND_CONTEXT.supply.currentSolar}. ${DEMAND_CONTEXT.supply.gasToEnergy}.

Produce TWO forecast scenarios for DBIS and Essequibo grids across 4 timeframes (6 months, 12 months, 18 months, 24 months):

SCENARIO A — CONSERVATIVE:
- Assume demand growth continues at the historical average rate
- No major new industrial connections beyond what's already committed
- Normal seasonal variation
- No supply-side improvements (current offline stations remain offline)
- This is the "nothing changes" baseline
- Explain what assumptions make this conservative

SCENARIO B — AGGRESSIVE (NON-CONSERVATIVE):
- Factor in accelerating economic growth from oil & gas expansion
- Include projected new commercial and industrial connections
- Account for residential growth from housing programs
- Consider the compounding effect of suppressed demand being released if supply improves
- Include potential demand spikes from new large-load customers
- This represents the realistic upside risk that the Ministry should plan for
- Explain what assumptions make this aggressive

For EACH scenario, provide:
1. Projected peak demand (MW) for DBIS and Essequibo at 6, 12, 18, 24 months
2. Projected reserve margin at each timeframe (against current installed capacity)
3. The month/quarter when reserve margin breaches 15% safe threshold (if applicable)
4. The month/quarter when load shedding becomes unavoidable without new capacity
5. Confidence level (high/medium/low) for each projection
6. The 3 biggest risk factors that could push demand higher than projected
7. The 3 biggest factors that could moderate demand growth

IMPORTANT: Show your reasoning. For each number, briefly explain what's driving it. The Director General needs to understand WHY, not just WHAT.

Respond in valid JSON with this exact structure:
{
  "generated_at": "ISO timestamp",
  "data_period": "start - end of historical data used",
  "methodology_summary": "2-3 sentence explanation of approach",
  "conservative": {
    "label": "Conservative Baseline",
    "assumptions": ["assumption 1", "assumption 2", "assumption 3", "assumption 4"],
    "dbis": {
      "current_peak": ${latestDBIS},
      "month_6": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "month_12": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "month_18": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "month_24": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "growth_rate_mw_per_month": number,
      "safe_threshold_breach_date": "YYYY-MM or null if not breached within 24 months",
      "load_shedding_unavoidable_date": "YYYY-MM or null if not within 24 months"
    },
    "essequibo": {
      "current_peak": ${latestEsq},
      "month_6": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "month_12": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "month_18": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "month_24": { "peak_mw": number, "reserve_margin_pct": number, "confidence": "high|medium|low", "reasoning": "string" },
      "growth_rate_mw_per_month": number,
      "safe_threshold_breach_date": "YYYY-MM or null",
      "load_shedding_unavoidable_date": "YYYY-MM or null"
    },
    "risk_factors_upside": ["factor 1", "factor 2", "factor 3"],
    "moderating_factors": ["factor 1", "factor 2", "factor 3"]
  },
  "aggressive": {
    "label": "Aggressive Growth",
    "assumptions": ["assumption 1", "assumption 2", "assumption 3", "assumption 4"],
    "dbis": { same structure as conservative.dbis },
    "essequibo": { same structure as conservative.essequibo },
    "risk_factors_upside": ["factor 1", "factor 2", "factor 3"],
    "moderating_factors": ["factor 1", "factor 2", "factor 3"]
  },
  "demand_drivers": {
    "industrial": { "factors": ["oil & gas operations", "manufacturing"], "impact": "High - primary growth driver" },
    "commercial": { "factors": ["construction", "tourism", "retail"], "impact": "Medium-High - sustained growth" },
    "residential": { "factors": ["housing programs", "population growth"], "impact": "Medium - steady baseline growth" },
    "seasonal": { "factors": ["dry season cooling", "agricultural processing"], "impact": "Low-Medium - predictable variation" }
  },
  "executive_summary": "3-4 sentence summary comparing both scenarios and the key decision point for the Ministry"
}`;
}

/**
 * Generate multivariate forecast using Claude Opus
 */
async function generateForecast() {
  const startTime = Date.now();

  try {
    // Stage 1: Assemble data
    console.log('[MultiForecast] Assembling historical data...');
    const historicalData = await assembleHistoricalData();

    if (historicalData.monthlyKPIs.length < 3) {
      console.log('[MultiForecast] Insufficient historical data, using fallback');
      return generateFallbackForecast(historicalData);
    }

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('[MultiForecast] No API key, using fallback');
      return generateFallbackForecast(historicalData);
    }

    // Stage 2: Call Claude Opus
    console.log('[MultiForecast] Calling Claude Opus for analysis...');
    const prompt = buildForecastPrompt(historicalData);

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

    // Parse JSON response
    let forecast;
    try {
      // Find JSON in response (may have markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        forecast = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseErr) {
      console.error('[MultiForecast] Failed to parse Claude response:', parseErr);
      console.log('[MultiForecast] Raw response:', responseText.slice(0, 500));
      return generateFallbackForecast(historicalData);
    }

    // Add metadata
    forecast.metadata = {
      generatedAt: new Date().toISOString(),
      processingTimeMs: processingTime,
      model: AI_CONFIG.MODEL,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      dataPointsUsed: historicalData.monthlyKPIs.length,
      isFallback: false
    };

    // Save to database
    await saveForecastToDb(forecast);

    console.log(`[MultiForecast] Generated successfully in ${processingTime}ms`);
    return { success: true, forecast };

  } catch (err) {
    console.error('[MultiForecast] Generation error:', err);

    // Attempt fallback
    try {
      const historicalData = await assembleHistoricalData();
      const fallback = generateFallbackForecast(historicalData);
      return { success: true, forecast: fallback, warning: 'AI forecast unavailable, showing linear extrapolation' };
    } catch (fallbackErr) {
      return { success: false, error: err.message };
    }
  }
}

/**
 * Generate fallback linear projection when Claude is unavailable
 */
function generateFallbackForecast(historicalData) {
  const now = new Date();

  // Calculate growth rates from historical data
  const kpis = historicalData.monthlyKPIs;

  let dbisGrowth = 2.0; // Default 2 MW/month
  let esqGrowth = 0.16; // Default 0.16 MW/month

  if (kpis.length >= 2) {
    const firstDbis = kpis.find(k => k.peakDemandDBIS)?.peakDemandDBIS;
    const lastDbis = [...kpis].reverse().find(k => k.peakDemandDBIS)?.peakDemandDBIS;
    if (firstDbis && lastDbis) {
      dbisGrowth = Math.max(0.5, (lastDbis - firstDbis) / kpis.length);
    }

    const firstEsq = kpis.find(k => k.peakDemandEssequibo)?.peakDemandEssequibo;
    const lastEsq = [...kpis].reverse().find(k => k.peakDemandEssequibo)?.peakDemandEssequibo;
    if (firstEsq && lastEsq) {
      esqGrowth = Math.max(0.05, (lastEsq - firstEsq) / kpis.length);
    }
  }

  const currentDbis = [...kpis].reverse().find(k => k.peakDemandDBIS)?.peakDemandDBIS || 200;
  const currentEsq = [...kpis].reverse().find(k => k.peakDemandEssequibo)?.peakDemandEssequibo || 13;

  const dbisCapacity = historicalData.capacityData?.find(c => c.grid === 'DBIS')?.current_capacity_mw || 230;
  const esqCapacity = historicalData.capacityData?.find(c => c.grid === 'Essequibo')?.current_capacity_mw || 36;

  // Helper to calculate reserve margin
  const calcReserve = (peak, capacity) => ((capacity - peak) / capacity) * 100;

  // Generate projections
  const makeProjection = (current, growth, capacity, months, multiplier = 1) => {
    const peak = current + (growth * multiplier * months);
    return {
      peak_mw: Math.round(peak * 10) / 10,
      reserve_margin_pct: Math.round(calcReserve(peak, capacity) * 10) / 10,
      confidence: months <= 12 ? 'medium' : 'low',
      reasoning: `Linear extrapolation: ${current.toFixed(1)} MW + (${(growth * multiplier).toFixed(2)} MW/month × ${months} months)`
    };
  };

  // Find breach dates
  const findBreachDate = (current, growth, capacity, threshold, multiplier = 1) => {
    const targetPeak = capacity * (1 - threshold / 100);
    const monthsToBreak = (targetPeak - current) / (growth * multiplier);
    if (monthsToBreak > 0 && monthsToBreak <= 24) {
      const breachDate = new Date(now);
      breachDate.setMonth(breachDate.getMonth() + Math.ceil(monthsToBreak));
      return breachDate.toISOString().slice(0, 7);
    }
    return null;
  };

  return {
    generated_at: now.toISOString(),
    data_period: `${historicalData.dataRange.start} - ${historicalData.dataRange.end}`,
    methodology_summary: 'Linear extrapolation based on historical monthly growth rates. This is a simplified projection; AI-powered analysis unavailable.',
    conservative: {
      label: 'Conservative Baseline',
      assumptions: [
        'Demand continues at historical average growth rate',
        'No major new industrial connections',
        'Current capacity constraints persist',
        'Normal seasonal variation'
      ],
      dbis: {
        current_peak: currentDbis,
        month_6: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 6),
        month_12: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 12),
        month_18: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 18),
        month_24: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 24),
        growth_rate_mw_per_month: Math.round(dbisGrowth * 100) / 100,
        safe_threshold_breach_date: findBreachDate(currentDbis, dbisGrowth, dbisCapacity, 15),
        load_shedding_unavoidable_date: findBreachDate(currentDbis, dbisGrowth, dbisCapacity, 5)
      },
      essequibo: {
        current_peak: currentEsq,
        month_6: makeProjection(currentEsq, esqGrowth, esqCapacity, 6),
        month_12: makeProjection(currentEsq, esqGrowth, esqCapacity, 12),
        month_18: makeProjection(currentEsq, esqGrowth, esqCapacity, 18),
        month_24: makeProjection(currentEsq, esqGrowth, esqCapacity, 24),
        growth_rate_mw_per_month: Math.round(esqGrowth * 100) / 100,
        safe_threshold_breach_date: findBreachDate(currentEsq, esqGrowth, esqCapacity, 15),
        load_shedding_unavoidable_date: findBreachDate(currentEsq, esqGrowth, esqCapacity, 5)
      },
      risk_factors_upside: [
        'Faster than expected oil & gas sector growth',
        'Large industrial customer connections',
        'Hotter than normal dry season'
      ],
      moderating_factors: [
        'Economic slowdown',
        'Energy efficiency improvements',
        'Distributed solar adoption'
      ]
    },
    aggressive: {
      label: 'Aggressive Growth',
      assumptions: [
        'Oil & gas expansion accelerates demand growth by 50%',
        'New commercial and industrial connections come online',
        'Housing program completions add residential load',
        'Suppressed demand released as supply improves'
      ],
      dbis: {
        current_peak: currentDbis,
        month_6: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 6, 1.5),
        month_12: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 12, 1.5),
        month_18: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 18, 1.5),
        month_24: makeProjection(currentDbis, dbisGrowth, dbisCapacity, 24, 1.5),
        growth_rate_mw_per_month: Math.round(dbisGrowth * 1.5 * 100) / 100,
        safe_threshold_breach_date: findBreachDate(currentDbis, dbisGrowth, dbisCapacity, 15, 1.5),
        load_shedding_unavoidable_date: findBreachDate(currentDbis, dbisGrowth, dbisCapacity, 5, 1.5)
      },
      essequibo: {
        current_peak: currentEsq,
        month_6: makeProjection(currentEsq, esqGrowth, esqCapacity, 6, 1.5),
        month_12: makeProjection(currentEsq, esqGrowth, esqCapacity, 12, 1.5),
        month_18: makeProjection(currentEsq, esqGrowth, esqCapacity, 18, 1.5),
        month_24: makeProjection(currentEsq, esqGrowth, esqCapacity, 24, 1.5),
        growth_rate_mw_per_month: Math.round(esqGrowth * 1.5 * 100) / 100,
        safe_threshold_breach_date: findBreachDate(currentEsq, esqGrowth, esqCapacity, 15, 1.5),
        load_shedding_unavoidable_date: findBreachDate(currentEsq, esqGrowth, esqCapacity, 5, 1.5)
      },
      risk_factors_upside: [
        'Multiple large industrial projects commissioned simultaneously',
        'Cryptocurrency mining operations',
        'Regional data center development'
      ],
      moderating_factors: [
        'Project delays',
        'Global economic headwinds',
        'Grid connection bottlenecks'
      ]
    },
    demand_drivers: {
      industrial: { factors: ['Oil & gas operations', 'Shore base facilities', 'Manufacturing'], impact: 'High - primary growth driver' },
      commercial: { factors: ['Construction boom', 'Tourism growth', 'Retail expansion'], impact: 'Medium-High - sustained growth' },
      residential: { factors: ['Government housing programs', 'Population growth'], impact: 'Medium - steady baseline' },
      seasonal: { factors: ['Dry season cooling loads', 'Agricultural processing'], impact: 'Low-Medium - predictable variation' }
    },
    executive_summary: `Based on ${historicalData.dataRange.monthsAvailable} months of historical data, DBIS peak demand is growing at approximately ${dbisGrowth.toFixed(1)} MW/month. The conservative scenario projects demand reaching ${(currentDbis + dbisGrowth * 24).toFixed(0)} MW in 24 months, while the aggressive scenario (factoring in accelerated economic growth) projects ${(currentDbis + dbisGrowth * 1.5 * 24).toFixed(0)} MW. The Ministry should monitor actual growth against these scenarios and plan capacity additions accordingly.`,
    metadata: {
      generatedAt: now.toISOString(),
      processingTimeMs: 0,
      model: 'fallback-linear',
      inputTokens: 0,
      outputTokens: 0,
      dataPointsUsed: historicalData.monthlyKPIs.length,
      isFallback: true
    }
  };
}

/**
 * Save forecast to database
 */
async function saveForecastToDb(forecast) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO gpl_multivariate_forecasts (
        generated_at, data_period, methodology_summary,
        conservative_json, aggressive_json, demand_drivers_json,
        executive_summary, model_used, processing_time_ms,
        input_tokens, output_tokens, is_fallback
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      forecast.metadata.generatedAt,
      forecast.data_period,
      forecast.methodology_summary,
      JSON.stringify(forecast.conservative),
      JSON.stringify(forecast.aggressive),
      JSON.stringify(forecast.demand_drivers),
      forecast.executive_summary,
      forecast.metadata.model,
      forecast.metadata.processingTimeMs,
      forecast.metadata.inputTokens,
      forecast.metadata.outputTokens,
      forecast.metadata.isFallback
    ]);
    console.log('[MultiForecast] Saved to database');
  } catch (err) {
    console.error('[MultiForecast] Failed to save:', err);
    // Non-fatal, continue
  } finally {
    client.release();
  }
}

/**
 * Get latest saved forecast from database
 */
async function getLatestForecast() {
  try {
    const result = await pool.query(`
      SELECT * FROM gpl_multivariate_forecasts
      ORDER BY generated_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      generated_at: row.generated_at,
      data_period: row.data_period,
      methodology_summary: row.methodology_summary,
      conservative: row.conservative_json,
      aggressive: row.aggressive_json,
      demand_drivers: row.demand_drivers_json,
      executive_summary: row.executive_summary,
      metadata: {
        generatedAt: row.generated_at,
        processingTimeMs: row.processing_time_ms,
        model: row.model_used,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        isFallback: row.is_fallback
      }
    };
  } catch (err) {
    console.error('[MultiForecast] Failed to get latest:', err);
    return null;
  }
}

module.exports = {
  generateForecast,
  getLatestForecast,
  assembleHistoricalData,
  DEMAND_CONTEXT
};
