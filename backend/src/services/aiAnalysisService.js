const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('../utils/logger');

/**
 * AI Analysis Service using Claude API
 *
 * Analyzes daily metrics and provides:
 * - Anomaly detection
 * - Executive summary
 * - Attention items by agency
 */

// Configuration
const CONFIG = {
  MODEL: 'claude-opus-4-5-20251101',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.3, // Lower temperature for more consistent analysis
};

// Initialize Anthropic client
let anthropicClient = null;

function getClient() {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Build the analysis prompt from metrics data
 * @param {Array} metrics - Array of metric records
 * @param {string} date - The date being analyzed
 * @returns {string} - The prompt for Claude
 */
function buildAnalysisPrompt(metrics, date) {
  // Group metrics by agency and category
  const byAgency = {};
  const byCategory = {};

  for (const metric of metrics) {
    // Skip empty values
    if (metric.value_type === 'empty') continue;

    const agency = metric.agency || 'Unknown';
    const category = metric.category || 'Uncategorized';

    if (!byAgency[agency]) byAgency[agency] = [];
    if (!byCategory[category]) byCategory[category] = [];

    byAgency[agency].push(metric);
    byCategory[category].push(metric);
  }

  // Format metrics for the prompt
  const metricsText = metrics
    .filter(m => m.value_type !== 'empty')
    .map(m => {
      const value = m.numeric_value !== null ? m.numeric_value : m.raw_value;
      const unit = m.unit ? ` ${m.unit}` : '';
      const agency = m.agency ? ` [${m.agency}]` : '';
      const error = m.has_error ? ' [ERROR]' : '';
      return `- ${m.metric_name}${agency}: ${value}${unit}${error}`;
    })
    .join('\n');

  const agencyList = Object.keys(byAgency).join(', ');
  const totalMetrics = metrics.filter(m => m.value_type !== 'empty').length;
  const errorMetrics = metrics.filter(m => m.has_error).length;

  return `You are analyzing daily operational metrics for the Ministry of Public Utilities and Aviation in Guyana. The data is from ${date}.

## Agencies Covered
The ministry oversees four agencies:
- GPL (Guyana Power & Light) - Electricity generation and distribution
- GWI (Guyana Water Inc) - Water production and distribution
- CJIA (Cheddi Jagan International Airport) - Airport operations
- GCAA (Guyana Civil Aviation Authority) - Aviation regulation and safety

## Today's Metrics (${totalMetrics} values, ${errorMetrics} errors)

${metricsText}

## Your Analysis Task

Please provide a structured analysis with the following sections:

### 1. EXECUTIVE SUMMARY
A brief 2-3 sentence overview of the day's operations across all agencies. Highlight the most significant findings.

### 2. ANOMALIES DETECTED
List any values that appear unusual, unexpected, or potentially erroneous. For each anomaly:
- Metric name and value
- Why it's flagged as anomalous
- Severity: LOW, MEDIUM, or HIGH
- Recommended action

### 3. ATTENTION ITEMS
List specific items requiring management attention, grouped by agency (GPL, GWI, CJIA, GCAA). Include:
- What needs attention
- Priority: URGENT, HIGH, MEDIUM, LOW
- Suggested next steps

### 4. AGENCY SUMMARIES
Brief summary for each agency present in the data:
- GPL: Power generation status, capacity, outages
- GWI: Water production, losses, service disruptions
- CJIA: Flight operations, safety, revenue
- GCAA: Compliance, inspections, incidents

Respond in JSON format:
{
  "executive_summary": "string",
  "anomalies": [
    {
      "metric_name": "string",
      "value": "string",
      "reason": "string",
      "severity": "LOW|MEDIUM|HIGH",
      "recommendation": "string"
    }
  ],
  "attention_items": [
    {
      "agency": "string",
      "item": "string",
      "priority": "URGENT|HIGH|MEDIUM|LOW",
      "next_steps": "string"
    }
  ],
  "agency_summaries": {
    "GPL": "string or null if no data",
    "GWI": "string or null if no data",
    "CJIA": "string or null if no data",
    "GCAA": "string or null if no data"
  }
}`;
}

/**
 * Parse Claude's response into structured data
 * @param {string} response - Claude's text response
 * @returns {Object} - Parsed analysis object
 */
function parseAnalysisResponse(response) {
  try {
    // Try to extract JSON from the response
    // Claude might wrap it in markdown code blocks
    let jsonStr = response;

    // Remove markdown code blocks if present
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Try to find JSON object in the response
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    // Validate structure
    return {
      executive_summary: parsed.executive_summary || 'Analysis completed.',
      anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
      attention_items: Array.isArray(parsed.attention_items) ? parsed.attention_items : [],
      agency_summaries: parsed.agency_summaries || {}
    };
  } catch (error) {
    logger.warn('Failed to parse Claude response as JSON, using raw text', { error: error.message });

    // Return a basic structure with the raw response
    return {
      executive_summary: response.slice(0, 500),
      anomalies: [],
      attention_items: [],
      agency_summaries: {},
      raw_text: response
    };
  }
}

/**
 * Analyze metrics using Claude API
 * @param {Array} metrics - Array of metric records from Excel parser
 * @param {string} date - The date being analyzed
 * @param {Object} options - Additional options
 * @returns {Object} - Analysis result
 */
async function analyzeMetrics(metrics, date, options = {}) {
  const startTime = Date.now();

  try {
    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn('ANTHROPIC_API_KEY not configured, skipping AI analysis');
      return {
        success: false,
        error: 'AI analysis not configured (missing API key)',
        skipped: true
      };
    }

    const client = getClient();

    // Build the prompt
    const prompt = buildAnalysisPrompt(metrics, date);

    logger.info('Starting AI analysis', {
      date,
      metricCount: metrics.length,
      model: CONFIG.MODEL
    });

    // Call Claude API
    const response = await client.messages.create({
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      temperature: CONFIG.TEMPERATURE,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const processingTime = Date.now() - startTime;

    // Extract text from response
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse the response
    const analysis = parseAnalysisResponse(responseText);

    logger.info('AI analysis completed', {
      date,
      processingTimeMs: processingTime,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      anomalyCount: analysis.anomalies.length,
      attentionCount: analysis.attention_items.length
    });

    return {
      success: true,
      analysis: analysis,
      meta: {
        model: CONFIG.MODEL,
        processingTimeMs: processingTime,
        promptTokens: response.usage?.input_tokens,
        completionTokens: response.usage?.output_tokens,
        stopReason: response.stop_reason
      },
      rawResponse: options.includeRaw ? responseText : undefined
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error('AI analysis failed', {
      error: error.message,
      errorType: error.constructor.name,
      date,
      processingTimeMs: processingTime
    });

    // Determine if it's a retryable error
    const isRetryable = error.status === 429 || // Rate limit
                        error.status === 500 || // Server error
                        error.status === 503;   // Service unavailable

    return {
      success: false,
      error: error.message,
      errorType: error.constructor.name,
      isRetryable,
      processingTimeMs: processingTime
    };
  }
}

/**
 * Quick health check for the AI service
 * @returns {Object} - Health status
 */
async function healthCheck() {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        healthy: false,
        configured: false,
        error: 'ANTHROPIC_API_KEY not set'
      };
    }

    // Try a minimal API call
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307', // Use cheaper model for health check
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Respond with "OK"' }]
    });

    return {
      healthy: true,
      configured: true,
      model: CONFIG.MODEL
    };

  } catch (error) {
    return {
      healthy: false,
      configured: true,
      error: error.message
    };
  }
}

/**
 * Build GPL-specific analysis prompt
 * @param {Object} context - GPL analysis context from controller
 * @returns {string} - The prompt for Claude
 */
function buildGPLPrompt(context) {
  const { reportDate, systemOverview, renewables, unitStats, stations, criticalStations, outages } = context;

  // Format station data
  const stationLines = stations.map(s =>
    `  - ${s.name}: ${s.online}/${s.units} units online, ${s.availableMw?.toFixed(1) || 0}/${s.capacityMw?.toFixed(1) || 0} MW (${s.utilizationPct?.toFixed(1) || 0}%)`
  ).join('\n');

  // Format outage data
  const outageLines = outages.length > 0
    ? outages.map(o =>
        `  - ${o.station} ${o.unit || ''}: ${o.reason || 'Unknown reason'}${o.expectedCompletion ? ` (ETA: ${o.expectedCompletion})` : ''}`
      ).join('\n')
    : '  None reported';

  return `You are the AI briefing system for the Ministry of Public Utilities in Guyana, analyzing daily power generation data from GPL (Guyana Power & Light).

## Report Date: ${reportDate}

## SYSTEM OVERVIEW
- Total Fossil Fuel Capacity: ${systemOverview.totalCapacityMw?.toFixed(2) || 'N/A'} MW
- Available Capacity: ${systemOverview.availableCapacityMw?.toFixed(2) || 'N/A'} MW
- Expected Peak Demand: ${systemOverview.expectedPeakMw?.toFixed(2) || 'N/A'} MW
- Reserve Capacity: ${systemOverview.reserveCapacityMw?.toFixed(2) || 'N/A'} MW
- Reserve Margin: ${systemOverview.reserveMarginPct?.toFixed(2) || 'N/A'}%
- Forced Outage Rate (FOR): ${(systemOverview.averageFOR * 100)?.toFixed(2) || 'N/A'}%
- Evening Peak: ${systemOverview.eveningPeak?.onBars?.toFixed(2) || 'N/A'} MW on bars (${systemOverview.eveningPeak?.suppressed?.toFixed(2) || 'N/A'} MW suppressed)
- Day Peak: ${systemOverview.dayPeak?.onBars?.toFixed(2) || 'N/A'} MW on bars

## RENEWABLES
- Hampshire Solar: ${renewables.hampshireMwp || 0} MWp
- Prospect Solar: ${renewables.prospectMwp || 0} MWp
- Trafalgar Solar: ${renewables.trafalgarMwp || 0} MWp
- Total Renewable: ${renewables.totalMwp || 0} MWp

## UNIT STATUS
- Total Units: ${unitStats.total}
- Online: ${unitStats.online} (${((unitStats.online/unitStats.total)*100).toFixed(1)}%)
- Offline: ${unitStats.offline}
- No Data: ${unitStats.noData}
- Offline Capacity: ${unitStats.offlineCapacityMw?.toFixed(2) || 0} MW

## STATION BREAKDOWN
${stationLines}

## CRITICAL STATIONS (Below 50% utilization or more offline than online)
${criticalStations.length > 0 ? criticalStations.join(', ') : 'None'}

## CURRENT OUTAGES
${outageLines}

---

## YOUR ANALYSIS TASK

Provide an executive briefing for the Permanent Secretary and Minister. Be concise but comprehensive.

Respond in JSON format:
{
  "executiveBriefing": "A 3-5 paragraph executive summary suitable for ministerial briefing. Start with overall system health, then highlight critical issues, then discuss trends and recommendations. Use plain language.",

  "criticalAlerts": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM",
      "title": "Brief alert title",
      "description": "What's happening and why it matters",
      "recommendation": "Immediate action recommended"
    }
  ],

  "stationConcerns": [
    {
      "station": "Station name",
      "issue": "What's wrong",
      "impact": "Impact on generation capacity",
      "priority": "HIGH|MEDIUM|LOW"
    }
  ],

  "recommendations": [
    {
      "category": "Operations|Maintenance|Planning|Policy",
      "recommendation": "Specific actionable recommendation",
      "rationale": "Why this is recommended",
      "urgency": "Immediate|Short-term|Long-term"
    }
  ]
}

Focus on:
1. System reliability and reserve adequacy
2. Risk of load shedding or blackouts
3. Station performance issues
4. Maintenance and operational priorities
5. Trends that may need policy attention`;
}

/**
 * Generate GPL executive briefing using Claude
 * @param {Object} context - Analysis context from controller
 * @returns {Object} - Structured AI response
 */
async function generateGPLBriefing(context) {
  const startTime = Date.now();

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn('ANTHROPIC_API_KEY not configured');
      return {
        success: false,
        error: 'AI analysis not configured',
        executiveBriefing: 'AI analysis is not available. Please configure the Anthropic API key.',
        criticalAlerts: [],
        stationConcerns: [],
        recommendations: []
      };
    }

    const client = getClient();
    const prompt = buildGPLPrompt(context);

    logger.info('Starting GPL AI analysis', {
      reportDate: context.reportDate,
      model: CONFIG.MODEL
    });

    const response = await client.messages.create({
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      temperature: CONFIG.TEMPERATURE,
      messages: [{ role: 'user', content: prompt }]
    });

    const processingTime = Date.now() - startTime;

    // Extract text response
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse JSON from response
    let parsed;
    try {
      // Remove markdown code blocks if present
      let jsonStr = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.warn('Failed to parse GPL AI response as JSON', { error: parseError.message });
      parsed = {
        executiveBriefing: responseText.slice(0, 2000),
        criticalAlerts: [],
        stationConcerns: [],
        recommendations: []
      };
    }

    logger.info('GPL AI analysis completed', {
      reportDate: context.reportDate,
      processingTimeMs: processingTime,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens
    });

    return {
      success: true,
      executiveBriefing: parsed.executiveBriefing || 'Analysis completed.',
      criticalAlerts: parsed.criticalAlerts || [],
      stationConcerns: parsed.stationConcerns || [],
      recommendations: parsed.recommendations || [],
      rawResponse: parsed,
      usage: {
        promptTokens: response.usage?.input_tokens,
        completionTokens: response.usage?.output_tokens
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('GPL AI analysis failed', {
      error: error.message,
      reportDate: context.reportDate,
      processingTimeMs: processingTime
    });

    return {
      success: false,
      error: error.message,
      executiveBriefing: `AI analysis failed: ${error.message}`,
      criticalAlerts: [],
      stationConcerns: [],
      recommendations: []
    };
  }
}

module.exports = {
  analyzeMetrics,
  generateGPLBriefing,
  healthCheck,
  buildAnalysisPrompt,
  buildGPLPrompt,
  CONFIG
};
