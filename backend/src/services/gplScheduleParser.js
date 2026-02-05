const XLSX = require('xlsx');
const { logger } = require('../utils/logger');

/**
 * GPL DBIS Schedule Sheet Parser
 *
 * Parses the "Schedule" sheet from the DBIS Excel workbook:
 * - ~2,557 columns (growing daily)
 * - Row 4: Date headers (datetime values)
 * - Rows 5-68: Individual generating units
 * - Rows 69-83: Summary/calculated rows
 *
 * Columns A-F are static metadata, G onwards are daily values.
 */

// Configuration - ROW NUMBERS (1-indexed as in Excel)
const CONFIG = {
  // Row numbers
  DATE_HEADER_ROW: 4,
  UNIT_START_ROW: 5,
  UNIT_END_ROW: 68,
  SUMMARY_START_ROW: 69,
  SUMMARY_END_ROW: 83,

  // Summary row mappings (1-indexed Excel rows)
  SUMMARY_ROWS: {
    TOTAL_FOSSIL: 69,
    EXPECTED_PEAK: 70,
    RESERVE_CAPACITY: 71,
    AVERAGE_FOR: 72,
    EXPECTED_CAPACITY: 73,
    EXPECTED_RESERVE: 74,
    SOLAR_HAMPSHIRE: 75,
    SOLAR_PROSPECT: 76,
    SOLAR_TRAFALGAR: 77,
    TOTAL_RENEWABLE: 78,
    TOTAL_DBIS: 79,
    EVENING_PEAK: 80,
    DAY_PEAK: 81,
    GEN_AVAILABILITY: 82,
    APPROX_SUPPRESSED: 83
  },

  // Column indices (0-indexed)
  COLS: {
    STATION: 0,      // A
    ENGINE: 1,       // B
    UNIT_NUMBER: 2,  // C
    MVA: 3,          // D
    MW_INSTALLED: 4, // E
    MW_DERATED: 5,   // F
    DATA_START: 6    // G onwards
  },

  // Timezone offset for Guyana (UTC-4)
  TIMEZONE_OFFSET: -4,

  // Station definitions with expected row ranges
  STATIONS: [
    { name: 'SEI', startRow: 5, endRow: 7 },
    { name: 'Canefield', startRow: 8, endRow: 13 },
    { name: 'Onverwagt', startRow: 14, endRow: 23 },
    { name: 'GOE', startRow: 24, endRow: 24 },
    { name: 'DP1', startRow: 25, endRow: 28 },
    { name: 'DP2', startRow: 29, endRow: 32 },
    { name: 'DP3', startRow: 33, endRow: 37 },
    { name: 'DP4', startRow: 38, endRow: 40 },
    { name: 'DP5', startRow: 41, endRow: 45 },
    { name: 'COL', startRow: 46, endRow: 62 },
    { name: 'Power Ship 1', startRow: 63, endRow: 64 },
    { name: 'Power Ship 2', startRow: 65, endRow: 68 }
  ]
};

/**
 * Get yesterday's date in Guyana timezone (UTC-4)
 */
function getYesterdayGuyana() {
  const now = new Date();
  const guyanaTime = new Date(now.getTime() + (CONFIG.TIMEZONE_OFFSET * 60 * 60 * 1000));
  guyanaTime.setUTCDate(guyanaTime.getUTCDate() - 1);
  return guyanaTime.toISOString().split('T')[0];
}

/**
 * Parse Excel date (handles serial numbers, Date objects, strings)
 */
function parseExcelDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().split('T')[0];
  }

  if (typeof value === 'number' && value > 1 && value < 100000) {
    // Excel serial number
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().split('T')[0];
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return null;
}

/**
 * Normalize engine name (handle typos)
 */
function normalizeEngine(engine) {
  if (!engine) return null;
  const normalized = engine.toString().trim();
  // Handle Wartsila/Wartisla typo
  if (normalized.toLowerCase().includes('wart')) {
    return 'Wartsila';
  }
  return normalized;
}

/**
 * Parse peak demand format: "202.08(225.58)" or "181(207.8)"
 * Returns { onBars: number, suppressed: number }
 */
function parsePeakDemandFormat(value) {
  if (!value || value === '-') {
    return { onBars: null, suppressed: null };
  }

  const str = String(value).trim();

  // Match pattern: number(number)
  const match = str.match(/^([\d.]+)\s*\(([\d.]+)\)$/);
  if (match) {
    return {
      onBars: parseFloat(match[1]),
      suppressed: parseFloat(match[2])
    };
  }

  // Try plain number
  const num = parseFloat(str);
  if (!isNaN(num)) {
    return { onBars: num, suppressed: null };
  }

  return { onBars: null, suppressed: null };
}

/**
 * Convert column index to Excel column letter
 */
function indexToCol(index) {
  let col = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

/**
 * Get cell value from sheet
 */
function getCellValue(sheet, col, row) {
  const addr = typeof col === 'number' ? `${indexToCol(col)}${row}` : `${col}${row}`;
  const cell = sheet[addr];
  return cell ? (cell.v !== undefined ? cell.v : cell.w) : null;
}

/**
 * Find the column index for yesterday's date
 */
function findYesterdayColumn(sheet, sheetData) {
  const yesterday = getYesterdayGuyana();
  const dateRow = sheetData[CONFIG.DATE_HEADER_ROW - 1]; // 0-indexed array

  if (!dateRow) {
    return { error: 'Date header row (row 4) not found' };
  }

  let yesterdayCol = null;
  let lastPopulatedCol = null;
  let lastPopulatedDate = null;
  let scannedCount = 0;

  // Scan from column G (index 6) onwards
  for (let colIdx = CONFIG.COLS.DATA_START; colIdx < dateRow.length; colIdx++) {
    const cellValue = dateRow[colIdx];
    if (cellValue !== null && cellValue !== undefined) {
      const parsedDate = parseExcelDate(cellValue);
      if (parsedDate) {
        lastPopulatedCol = colIdx;
        lastPopulatedDate = parsedDate;
        scannedCount++;

        if (parsedDate === yesterday) {
          yesterdayCol = colIdx;
          break;
        }
      }
    }
  }

  if (yesterdayCol !== null) {
    return {
      column: yesterdayCol,
      columnLetter: indexToCol(yesterdayCol),
      date: yesterday,
      exactMatch: true,
      scannedColumns: scannedCount
    };
  }

  if (lastPopulatedCol !== null) {
    return {
      column: lastPopulatedCol,
      columnLetter: indexToCol(lastPopulatedCol),
      date: lastPopulatedDate,
      exactMatch: false,
      expectedDate: yesterday,
      scannedColumns: scannedCount
    };
  }

  return { error: 'No date columns found in row 4' };
}

/**
 * Forward-fill station names in column A
 * Station names only appear on the first row of each group
 */
function forwardFillStations(sheetData) {
  let currentStation = null;

  for (let rowIdx = CONFIG.UNIT_START_ROW - 1; rowIdx <= CONFIG.UNIT_END_ROW - 1; rowIdx++) {
    const row = sheetData[rowIdx];
    if (!row) continue;

    const stationCell = row[CONFIG.COLS.STATION];
    if (stationCell && String(stationCell).trim()) {
      currentStation = String(stationCell).trim();
    }
    // Store forward-filled value
    row._filledStation = currentStation;
  }
}

/**
 * Parse unit rows (5-68)
 */
function parseUnits(sheetData, dataColIdx) {
  const units = [];

  // Apply forward-fill first
  forwardFillStations(sheetData);

  for (let rowIdx = CONFIG.UNIT_START_ROW - 1; rowIdx <= CONFIG.UNIT_END_ROW - 1; rowIdx++) {
    const row = sheetData[rowIdx];
    if (!row) continue;

    const station = row._filledStation || row[CONFIG.COLS.STATION];
    if (!station) continue;

    const engine = normalizeEngine(row[CONFIG.COLS.ENGINE]);
    const unitNumber = row[CONFIG.COLS.UNIT_NUMBER];
    const installedMVA = parseFloat(row[CONFIG.COLS.MVA]) || null;
    const installedMW = parseFloat(row[CONFIG.COLS.MW_INSTALLED]) || null;
    const deratedMW = parseFloat(row[CONFIG.COLS.MW_DERATED]) || null;

    // Get available MW from yesterday's column
    const availableRaw = row[dataColIdx];
    let availableMW = null;
    let status = 'no_data';

    if (availableRaw !== null && availableRaw !== undefined && availableRaw !== '') {
      availableMW = parseFloat(availableRaw);
      if (!isNaN(availableMW)) {
        status = availableMW > 0 ? 'online' : 'offline';
      } else {
        availableMW = null;
        status = 'no_data';
      }
    }

    // Calculate utilization
    let utilizationPct = null;
    if (availableMW !== null && deratedMW && deratedMW > 0) {
      utilizationPct = Math.round((availableMW / deratedMW) * 10000) / 100;
    }

    units.push({
      rowNumber: rowIdx + 1, // 1-indexed
      station: String(station).trim(),
      engine,
      unitNumber: unitNumber !== null ? String(unitNumber) : null,
      installedCapacityMva: installedMVA,
      installedCapacityMw: installedMW,
      deratedCapacityMw: deratedMW,
      availableMw: availableMW,
      status,
      utilizationPct
    });
  }

  return units;
}

/**
 * Aggregate units by station
 */
function aggregateStations(units) {
  const stations = {};

  for (const unit of units) {
    const key = unit.station;
    if (!stations[key]) {
      stations[key] = {
        station: key,
        totalUnits: 0,
        totalDeratedCapacityMw: 0,
        totalAvailableMw: 0,
        unitsOnline: 0,
        unitsOffline: 0,
        unitsNoData: 0,
        stationUtilizationPct: null
      };
    }

    const s = stations[key];
    s.totalUnits++;
    s.totalDeratedCapacityMw += unit.deratedCapacityMw || 0;

    if (unit.status === 'online') {
      s.unitsOnline++;
      s.totalAvailableMw += unit.availableMw || 0;
    } else if (unit.status === 'offline') {
      s.unitsOffline++;
      // availableMw is 0, don't add
    } else {
      s.unitsNoData++;
      // Treat as 0 for sum
    }
  }

  // Calculate utilization for each station
  for (const station of Object.values(stations)) {
    if (station.totalDeratedCapacityMw > 0) {
      station.stationUtilizationPct = Math.round(
        (station.totalAvailableMw / station.totalDeratedCapacityMw) * 10000
      ) / 100;
    }
    // Round values
    station.totalDeratedCapacityMw = Math.round(station.totalDeratedCapacityMw * 10000) / 10000;
    station.totalAvailableMw = Math.round(station.totalAvailableMw * 10000) / 10000;
  }

  return Object.values(stations);
}

/**
 * Parse summary rows (69-83)
 */
function parseSummary(sheetData, dataColIdx) {
  const getValue = (rowNum) => {
    const row = sheetData[rowNum - 1]; // Convert to 0-indexed
    if (!row) return null;
    const val = row[dataColIdx];
    if (val === null || val === undefined || val === '' || val === '-') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
  };

  const getStringValue = (rowNum) => {
    const row = sheetData[rowNum - 1];
    if (!row) return null;
    return row[dataColIdx];
  };

  // Parse peak demand with special format
  const eveningPeakRaw = getStringValue(CONFIG.SUMMARY_ROWS.EVENING_PEAK);
  const dayPeakRaw = getStringValue(CONFIG.SUMMARY_ROWS.DAY_PEAK);

  const eveningPeak = parsePeakDemandFormat(eveningPeakRaw);
  const dayPeak = parsePeakDemandFormat(dayPeakRaw);

  // Get solar values
  const solarHampshire = getValue(CONFIG.SUMMARY_ROWS.SOLAR_HAMPSHIRE);
  const solarProspect = getValue(CONFIG.SUMMARY_ROWS.SOLAR_PROSPECT);
  const solarTrafalgar = getValue(CONFIG.SUMMARY_ROWS.SOLAR_TRAFALGAR);
  const totalRenewable = (solarHampshire || 0) + (solarProspect || 0) + (solarTrafalgar || 0);

  return {
    totalFossilFuelCapacityMw: getValue(CONFIG.SUMMARY_ROWS.TOTAL_FOSSIL),
    expectedPeakDemandMw: getValue(CONFIG.SUMMARY_ROWS.EXPECTED_PEAK),
    reserveCapacityMw: getValue(CONFIG.SUMMARY_ROWS.RESERVE_CAPACITY),
    averageFor: getValue(CONFIG.SUMMARY_ROWS.AVERAGE_FOR),
    expectedCapacityMw: getValue(CONFIG.SUMMARY_ROWS.EXPECTED_CAPACITY),
    expectedReserveMw: getValue(CONFIG.SUMMARY_ROWS.EXPECTED_RESERVE),
    solarHampshireMwp: solarHampshire,
    solarProspectMwp: solarProspect,
    solarTrafalgarMwp: solarTrafalgar,
    totalRenewableMwp: totalRenewable,
    totalDbisCapacityMw: getValue(CONFIG.SUMMARY_ROWS.TOTAL_DBIS),
    eveningPeakOnBarsMw: eveningPeak.onBars,
    eveningPeakSuppressedMw: eveningPeak.suppressed,
    dayPeakOnBarsMw: dayPeak.onBars,
    dayPeakSuppressedMw: dayPeak.suppressed,
    genAvailabilityAtSuppressedPeak: getValue(CONFIG.SUMMARY_ROWS.GEN_AVAILABILITY),
    approxSuppressedPeak: getValue(CONFIG.SUMMARY_ROWS.APPROX_SUPPRESSED)
  };
}

/**
 * Main parser function for Schedule sheet
 */
function parseScheduleSheet(buffer) {
  const startTime = Date.now();
  const warnings = [];

  try {
    // Read workbook
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: true,
      dense: false
    });

    // Get Schedule sheet
    const scheduleSheet = workbook.Sheets['Schedule'];
    if (!scheduleSheet) {
      return {
        success: false,
        error: 'Schedule sheet not found',
        availableSheets: workbook.SheetNames
      };
    }

    // Convert to array format for easier processing
    const sheetData = XLSX.utils.sheet_to_json(scheduleSheet, {
      header: 1,
      defval: null,
      raw: true
    });

    logger.info('Parsing GPL Schedule sheet', {
      totalRows: sheetData.length,
      sheetNames: workbook.SheetNames
    });

    // Find yesterday's column
    const dateResult = findYesterdayColumn(scheduleSheet, sheetData);
    if (dateResult.error) {
      return { success: false, error: dateResult.error };
    }

    if (!dateResult.exactMatch) {
      warnings.push({
        type: 'DATE_MISMATCH',
        message: `Expected ${dateResult.expectedDate} but found ${dateResult.date}`,
        detectedDate: dateResult.date,
        expectedDate: dateResult.expectedDate
      });
    }

    const dataColIdx = dateResult.column;

    logger.info('Found data column', {
      column: dateResult.columnLetter,
      date: dateResult.date,
      exactMatch: dateResult.exactMatch
    });

    // Parse units
    const units = parseUnits(sheetData, dataColIdx);

    // Count units by status
    const onlineCount = units.filter(u => u.status === 'online').length;
    const offlineCount = units.filter(u => u.status === 'offline').length;
    const noDataCount = units.filter(u => u.status === 'no_data').length;

    if (noDataCount > units.length * 0.5) {
      warnings.push({
        type: 'HIGH_NO_DATA',
        message: `${noDataCount} of ${units.length} units have no data (>50%)`,
        count: noDataCount,
        total: units.length
      });
    }

    // Aggregate by station
    const stations = aggregateStations(units);

    // Parse summary rows
    const summary = parseSummary(sheetData, dataColIdx);

    // Calculate system metrics
    const totalAvailable = stations.reduce((sum, s) => sum + s.totalAvailableMw, 0);
    const totalDerated = stations.reduce((sum, s) => sum + s.totalDeratedCapacityMw, 0);

    const systemUtilizationPct = totalDerated > 0
      ? Math.round((totalAvailable / totalDerated) * 10000) / 100
      : null;

    const reserveMarginPct = summary.eveningPeakOnBarsMw && summary.eveningPeakOnBarsMw > 0
      ? Math.round(((totalAvailable - summary.eveningPeakOnBarsMw) / summary.eveningPeakOnBarsMw) * 10000) / 100
      : null;

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      data: {
        date: dateResult.date,
        dateColumn: dateResult.columnLetter,
        exactDateMatch: dateResult.exactMatch,
        expectedDate: dateResult.expectedDate,

        units,
        stations,
        summary: {
          ...summary,
          systemUtilizationPct,
          reserveMarginPct
        },

        stats: {
          totalUnits: units.length,
          unitsOnline: onlineCount,
          unitsOffline: offlineCount,
          unitsNoData: noDataCount,
          totalStations: stations.length,
          totalAvailableMw: Math.round(totalAvailable * 100) / 100,
          totalDeratedMw: Math.round(totalDerated * 100) / 100,
          scannedColumns: dateResult.scannedColumns,
          processingTimeMs: processingTime
        }
      },
      warnings: warnings.length > 0 ? warnings : undefined
    };

  } catch (error) {
    logger.error('GPL Schedule parsing failed', {
      error: error.message,
      stack: error.stack
    });

    return {
      success: false,
      error: `Failed to parse Schedule sheet: ${error.message}`
    };
  }
}

module.exports = {
  parseScheduleSheet,
  getYesterdayGuyana,
  parsePeakDemandFormat,
  CONFIG
};
