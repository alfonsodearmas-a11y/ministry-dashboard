/**
 * GPL Generation Status Sheet Parser
 *
 * Parses the "Generation Status" sheet from DBIS Excel files
 * to extract unit status and outage information.
 *
 * ACTUAL Sheet Structure (11 columns, A-K):
 *
 * Row 1 headers (only C-E have headers):
 *   A: (no header) — Station/plant name (forward-fill)
 *   B: (no header) — Engine manufacturer
 *   C: "Unit No."
 *   D: "Installed Capacity (MVA)"
 *   E: "Installed /derated Capacity (MW)"
 *   F-K: (no headers in row 1)
 *
 * Row 4 has secondary headers:
 *   F: date value — "Available Capacity" column
 *   G: date value — "Dispatched Capacity" column
 *   H: "Reason for Outage"
 *   I: "Expected Completion Date"
 *   J: "Actual Completion Date"
 *   K: "Remarks"
 *
 * Data rows: 5 through ~41
 */

const XLSX = require('xlsx');

// Fixed column positions (0-indexed)
const COLS = {
  STATION: 0,           // A - forward-fill, station name
  ENGINE: 1,            // B - engine manufacturer
  UNIT_NO: 2,           // C - unit number
  INSTALLED_MVA: 3,     // D - installed capacity MVA
  DERATED_MW: 4,        // E - installed/derated capacity MW
  AVAILABLE_MW: 5,      // F - available capacity (0 = offline)
  DISPATCHED_MW: 6,     // G - dispatched capacity
  OUTAGE_REASON: 7,     // H - reason for outage
  EXPECTED_DATE: 8,     // I - expected completion date
  ACTUAL_DATE: 9,       // J - actual completion date
  REMARKS: 10           // K - remarks
};

const CONFIG = {
  DATA_START_ROW: 5,    // Row 5 (1-indexed) = index 4
  DATA_END_ROW: 50,     // Approximate end (will stop at summary rows)
  SUMMARY_INDICATORS: ['total', 'capacity', 'peak', 'demand', 'reserve', 'solar']
};

/**
 * Parse date from various formats
 */
function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value;
  }

  if (typeof value === 'number' && value > 1 && value < 100000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'n/a' || trimmed === '-') {
      return null;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

/**
 * Normalize station name to match Schedule sheet
 */
function normalizeStationName(name) {
  if (!name) return null;

  const normalized = name.toString().trim();
  if (!normalized) return null;

  const stationMap = {
    'sei': 'SEI',
    'skeldon': 'Skeldon',
    'canefield': 'Canefield',
    'garden of eden': 'Garden of Eden',
    'goe': 'GOE',
    'versailles': 'Versailles',
    'vreed-en-hoop': 'Vreed-en-Hoop',
    'vreed en hoop': 'Vreed-en-Hoop',
    'onverwagt': 'Onverwagt',
    'anna regina': 'Anna Regina',
    'triumph': 'Triumph',
    'leguan': 'Leguan',
    'wakenaam': 'Wakenaam',
    'bartica': 'Bartica',
    'linden': 'Linden',
    'col': 'COL',
    'dp1': 'DP1',
    'dp2': 'DP2',
    'dp3': 'DP3',
    'dp4': 'DP4',
    'dp5': 'DP5',
    'power ship 1': 'Power Ship 1',
    'power ship 2': 'Power Ship 2'
  };

  const key = normalized.toLowerCase();
  return stationMap[key] || normalized;
}

/**
 * Check if a row is a summary row (not unit data)
 */
function isSummaryRow(row) {
  if (!row) return true;

  const firstCell = row[0];
  if (!firstCell) return false;

  const text = firstCell.toString().toLowerCase();
  return CONFIG.SUMMARY_INDICATORS.some(ind => text.includes(ind));
}

/**
 * Check if text indicates maintenance or outage
 */
function containsOutageText(text) {
  if (!text) return false;
  const lower = text.toString().toLowerCase();
  return lower.includes('maintenance') ||
         lower.includes('repair') ||
         lower.includes('outage') ||
         lower.includes('fault') ||
         lower.includes('breakdown') ||
         lower.includes('offline') ||
         lower.includes('down') ||
         lower.includes('out of service') ||
         lower.includes('not available');
}

/**
 * Parse the Generation Status sheet
 *
 * @param {XLSX.WorkBook} workbook - The parsed Excel workbook
 * @param {string} reportDate - The report date for this data
 * @returns {Object} Parsed unit status and outage data
 */
function parseStatusSheet(workbook, reportDate) {
  const result = {
    success: false,
    outages: [],
    allUnits: [],
    warnings: [],
    error: null
  };

  try {
    // Find the sheet
    const sheetNames = workbook.SheetNames;
    let sheetName = null;

    const possibleNames = [
      'Generation Status',
      'Gen Status',
      'Status'
    ];

    for (const name of possibleNames) {
      const found = sheetNames.find(s =>
        s.toLowerCase().includes(name.toLowerCase())
      );
      if (found) {
        sheetName = found;
        break;
      }
    }

    if (!sheetName) {
      result.warnings.push('Generation Status sheet not found - no outage data will be extracted');
      result.success = true;
      return result;
    }

    const sheet = workbook.Sheets[sheetName];

    // Convert to array of arrays
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    if (data.length < CONFIG.DATA_START_ROW) {
      result.warnings.push('Generation Status sheet has insufficient rows');
      result.success = true;
      return result;
    }

    // Forward-fill station names
    let currentStation = null;

    // Parse data rows (row 5 onwards, 0-indexed = 4)
    for (let rowIdx = CONFIG.DATA_START_ROW - 1; rowIdx < Math.min(data.length, CONFIG.DATA_END_ROW); rowIdx++) {
      const row = data[rowIdx];

      if (!row || row.length === 0) continue;

      // Check if this is a summary row (stop parsing unit data)
      if (isSummaryRow(row)) {
        continue;
      }

      // Forward-fill station from column A
      const stationCell = row[COLS.STATION];
      if (stationCell && stationCell.toString().trim()) {
        currentStation = normalizeStationName(stationCell);
      }

      // Skip if we don't have a station yet
      if (!currentStation) continue;

      // Get unit data
      const engine = row[COLS.ENGINE] ? row[COLS.ENGINE].toString().trim() : null;
      const unitNo = row[COLS.UNIT_NO];
      const installedMva = parseFloat(row[COLS.INSTALLED_MVA]) || null;
      const deratedMw = parseFloat(row[COLS.DERATED_MW]) || null;
      const availableMw = parseFloat(row[COLS.AVAILABLE_MW]);
      const dispatchedMw = parseFloat(row[COLS.DISPATCHED_MW]);
      const outageReason = row[COLS.OUTAGE_REASON] ? row[COLS.OUTAGE_REASON].toString().trim() : null;
      const expectedDate = parseDate(row[COLS.EXPECTED_DATE]);
      const actualDate = parseDate(row[COLS.ACTUAL_DATE]);
      const remarks = row[COLS.REMARKS] ? row[COLS.REMARKS].toString().trim() : null;

      // Skip rows without unit number (likely header or summary rows)
      if (unitNo === null || unitNo === undefined) continue;

      // Determine status
      const isOffline = availableMw === 0 || isNaN(availableMw);
      const hasOutageReason = outageReason && outageReason.length > 0;
      const hasOutageRemarks = containsOutageText(remarks);

      // Determine if this is an outage
      const isOutage = isOffline || hasOutageReason || hasOutageRemarks;

      const unitData = {
        rowNumber: rowIdx + 1,
        station: currentStation,
        engine: engine,
        unitNumber: unitNo !== null ? unitNo.toString() : null,
        installedCapacityMva: installedMva,
        deratedCapacityMw: deratedMw,
        availableMw: isNaN(availableMw) ? 0 : availableMw,
        dispatchedMw: isNaN(dispatchedMw) ? 0 : dispatchedMw,
        outageReason: outageReason || null,
        expectedCompletion: expectedDate,
        actualCompletion: actualDate,
        remarks: remarks || null,
        status: isOffline ? 'offline' : 'online',
        isOutage: isOutage,
        reportDate: reportDate
      };

      result.allUnits.push(unitData);

      // Add to outages list if offline or has outage info
      if (isOutage) {
        result.outages.push({
          station: currentStation,
          engine: engine,
          unitNumber: unitNo !== null ? unitNo.toString() : null,
          availableMw: isNaN(availableMw) ? 0 : availableMw,
          dispatchedMw: isNaN(dispatchedMw) ? 0 : dispatchedMw,
          reason: outageReason || (hasOutageRemarks ? remarks : null),
          expectedCompletion: expectedDate,
          actualCompletion: actualDate,
          remarks: remarks,
          isResolved: actualDate !== null,
          reportDate: reportDate
        });
      }
    }

    result.success = true;

    // Summary stats
    const totalUnits = result.allUnits.length;
    const offlineUnits = result.allUnits.filter(u => u.status === 'offline').length;
    const onlineUnits = totalUnits - offlineUnits;

    console.log(`[GPL Status Parser] Parsed ${totalUnits} units: ${onlineUnits} online, ${offlineUnits} offline, ${result.outages.length} outages`);

    if (result.outages.length === 0 && offlineUnits > 0) {
      // This shouldn't happen if parsing is correct
      result.warnings.push(`Found ${offlineUnits} offline units but no outage records created`);
    }

  } catch (error) {
    result.error = `Failed to parse Generation Status sheet: ${error.message}`;
    result.success = false;
    console.error('[GPL Status Parser] Error:', error);
  }

  return result;
}

/**
 * Match outages to units from the Schedule sheet
 *
 * @param {Array} outages - Parsed outages from status sheet
 * @param {Array} scheduleUnits - Parsed units from schedule sheet
 * @returns {Array} Outages enriched with schedule unit data
 */
function matchOutagesToUnits(outages, scheduleUnits) {
  return outages.map(outage => {
    // Try to find matching unit in schedule
    const matchedUnit = scheduleUnits.find(unit => {
      const stationMatch = unit.station?.toLowerCase() === outage.station?.toLowerCase();
      const unitMatch = !outage.unitNumber ||
        unit.unitNumber?.toString() === outage.unitNumber?.toString();

      return stationMatch && unitMatch;
    });

    if (matchedUnit) {
      return {
        ...outage,
        matchedUnitRow: matchedUnit.rowNumber,
        scheduleDeratedMw: matchedUnit.deratedCapacityMw,
        scheduleAvailableMw: matchedUnit.availableMw,
        scheduleStatus: matchedUnit.status
      };
    }

    return outage;
  });
}

module.exports = {
  parseStatusSheet,
  matchOutagesToUnits,
  COLS,
  CONFIG
};
