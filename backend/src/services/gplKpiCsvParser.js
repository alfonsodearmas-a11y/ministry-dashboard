/**
 * GPL Monthly KPI CSV Parser
 *
 * Parses CSV files containing monthly KPI data:
 * - Date,KPI,Sum of Actual
 * - Handles UTF-8 BOM
 * - Normalizes Collection Rate % values
 * - Validates against known KPI list
 */

const csv = require('csv-parse/sync');

// Known KPI names
const KNOWN_KPIS = [
  'Affected Customers',
  'Collection Rate %',
  'HFO Generation Mix %',
  'LFO Generation Mix %',
  'Installed Capacity DBIS',
  'Installed Capacity Essequibo',
  'Peak Demand DBIS',
  'Peak Demand Essequibo'
];

/**
 * Remove UTF-8 BOM if present
 */
function removeBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  // Also handle the visible BOM characters
  if (content.startsWith('\ufeff')) {
    return content.slice(1);
  }
  return content;
}

/**
 * Parse date string to first-of-month Date
 * Input: "2025-12-31 00:00:00" → Output: 2025-12-01
 */
function parseToFirstOfMonth(dateStr) {
  if (!dateStr) return null;

  try {
    // Handle various date formats
    const cleaned = dateStr.toString().trim();

    // Try ISO format first: "2025-12-31 00:00:00" or "2025-12-31"
    const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1]);
      const month = parseInt(isoMatch[2]);
      // Return first of month
      return new Date(Date.UTC(year, month - 1, 1));
    }

    // Try MM/DD/YYYY format
    const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) {
      const month = parseInt(usMatch[1]);
      const year = parseInt(usMatch[3]);
      return new Date(Date.UTC(year, month - 1, 1));
    }

    // Fallback: try native Date parsing
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), 1));
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

/**
 * Normalize KPI value
 * - Collection Rate %: if < 1.5, multiply by 100
 * - All others: parse as number
 */
function normalizeValue(kpiName, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { value: null, raw: rawValue };
  }

  // Parse numeric value
  const strValue = rawValue.toString().trim();
  let numValue = parseFloat(strValue.replace(/,/g, ''));

  if (isNaN(numValue)) {
    return { value: null, raw: strValue };
  }

  // Special handling for Collection Rate %
  if (kpiName === 'Collection Rate %') {
    // If value is < 1.5, it's likely a decimal (0.87 = 87%)
    if (numValue < 1.5) {
      numValue = numValue * 100;
    }
  }

  return { value: numValue, raw: strValue };
}

/**
 * Parse GPL KPI CSV content
 *
 * @param {string|Buffer} content - CSV file content
 * @param {string} filename - Original filename
 * @returns {Object} Parsed result with preview data
 */
function parseKpiCsv(content, filename = 'unknown.csv') {
  const result = {
    success: false,
    filename,
    preview: null,
    data: [],
    warnings: [],
    error: null
  };

  try {
    // Convert buffer to string if needed
    let csvContent = content;
    if (Buffer.isBuffer(content)) {
      csvContent = content.toString('utf8');
    }

    // Remove BOM
    csvContent = removeBOM(csvContent);

    // Parse CSV
    const records = csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });

    if (records.length === 0) {
      result.error = 'CSV file is empty or has no data rows';
      return result;
    }

    // Check for required columns
    const firstRow = records[0];
    const columns = Object.keys(firstRow);

    // Find date column (could be "Date", "date", or similar)
    const dateCol = columns.find(c => c.toLowerCase().includes('date'));
    // Find KPI column
    const kpiCol = columns.find(c => c.toLowerCase() === 'kpi' || c.toLowerCase().includes('kpi'));
    // Find value column
    const valueCol = columns.find(c =>
      c.toLowerCase().includes('actual') ||
      c.toLowerCase().includes('value') ||
      c.toLowerCase() === 'sum of actual'
    );

    if (!dateCol) {
      result.error = 'Could not find Date column in CSV';
      return result;
    }
    if (!kpiCol) {
      result.error = 'Could not find KPI column in CSV';
      return result;
    }
    if (!valueCol) {
      result.error = 'Could not find Value/Actual column in CSV';
      return result;
    }

    // Parse all rows
    const parsedRows = [];
    const kpisFound = new Set();
    const monthsFound = new Set();
    const unknownKpis = new Set();
    let minDate = null;
    let maxDate = null;

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // 1-indexed, +1 for header

      const dateStr = row[dateCol];
      const kpiName = row[kpiCol]?.trim();
      const rawValue = row[valueCol];

      // Parse date
      const monthDate = parseToFirstOfMonth(dateStr);
      if (!monthDate) {
        result.warnings.push(`Row ${rowNum}: Invalid date "${dateStr}"`);
        continue;
      }

      // Validate KPI name
      if (!kpiName) {
        result.warnings.push(`Row ${rowNum}: Missing KPI name`);
        continue;
      }

      // Check if known KPI
      if (!KNOWN_KPIS.includes(kpiName)) {
        unknownKpis.add(kpiName);
      }

      // Normalize value
      const { value, raw } = normalizeValue(kpiName, rawValue);

      // Track stats
      kpisFound.add(kpiName);
      monthsFound.add(formatDate(monthDate));

      if (!minDate || monthDate < minDate) minDate = monthDate;
      if (!maxDate || monthDate > maxDate) maxDate = monthDate;

      parsedRows.push({
        reportMonth: formatDate(monthDate),
        kpiName,
        value,
        rawValue: raw
      });
    }

    // Warn about unknown KPIs
    if (unknownKpis.size > 0) {
      result.warnings.push(`Unknown KPI(s) found: ${Array.from(unknownKpis).join(', ')}`);
    }

    // Get latest month's snapshot
    const latestMonth = formatDate(maxDate);
    const latestSnapshot = {};
    parsedRows
      .filter(r => r.reportMonth === latestMonth)
      .forEach(r => {
        latestSnapshot[r.kpiName] = r.value;
      });

    // Build preview
    result.success = true;
    result.data = parsedRows;
    result.preview = {
      filename,
      totalRows: parsedRows.length,
      dateRange: {
        start: formatDate(minDate),
        end: formatDate(maxDate)
      },
      monthsCount: monthsFound.size,
      kpisFound: Array.from(kpisFound).sort(),
      knownKpisCount: Array.from(kpisFound).filter(k => KNOWN_KPIS.includes(k)).length,
      latestMonth,
      latestSnapshot
    };

    console.log(`[KPI Parser] Parsed ${parsedRows.length} rows, ${monthsFound.size} months, ${kpisFound.size} KPIs`);

  } catch (err) {
    result.error = `Failed to parse CSV: ${err.message}`;
    console.error('[KPI Parser] Error:', err);
  }

  return result;
}

/**
 * Get all data formatted for AI analysis
 */
function formatForAnalysis(data) {
  // Group by month
  const byMonth = {};
  data.forEach(row => {
    if (!byMonth[row.reportMonth]) {
      byMonth[row.reportMonth] = {};
    }
    byMonth[row.reportMonth][row.kpiName] = row.value;
  });

  // Sort months
  const sortedMonths = Object.keys(byMonth).sort();

  // Build text representation
  let text = 'Monthly KPI Data:\n\n';
  sortedMonths.forEach(month => {
    text += `${month}:\n`;
    const kpis = byMonth[month];
    Object.entries(kpis).forEach(([kpi, value]) => {
      if (value !== null) {
        text += `  - ${kpi}: ${value}\n`;
      }
    });
    text += '\n';
  });

  return {
    text,
    byMonth,
    sortedMonths,
    dateRange: {
      start: sortedMonths[0],
      end: sortedMonths[sortedMonths.length - 1]
    }
  };
}

module.exports = {
  parseKpiCsv,
  formatForAnalysis,
  KNOWN_KPIS,
  parseToFirstOfMonth,
  normalizeValue
};
