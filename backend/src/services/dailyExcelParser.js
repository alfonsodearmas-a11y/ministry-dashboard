const XLSX = require('xlsx');
const { logger } = require('../utils/logger');

/**
 * Daily Excel Parser for Wide-Format Ministry Data
 *
 * Handles Excel files with:
 * - 2,500+ columns (dates as column headers)
 * - ~80 rows of KPI metrics
 * - Columns A-F: Metric metadata
 * - Row 4: Date headers
 * - Rows 5-83: Data values
 *
 * Automatically detects yesterday's date column and extracts only that data.
 */

// Configuration
const CONFIG = {
  METADATA_COLUMNS: ['A', 'B', 'C', 'D', 'E', 'F'],
  DATA_START_COLUMN: 'G', // First date column
  HEADER_ROW: 4,          // Row containing date headers (1-indexed)
  DATA_START_ROW: 5,      // First data row (1-indexed)
  DATA_END_ROW: 83,       // Last data row (1-indexed)
  TIMEZONE_OFFSET: -4,    // Guyana timezone (UTC-4)
  MAX_EMPTY_PERCENTAGE: 50, // Warn if more than 50% empty
};

// Column letter to index conversion
function colToIndex(col) {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index - 1; // 0-indexed
}

// Index to column letter conversion
function indexToCol(index) {
  let col = '';
  index += 1; // 1-indexed
  while (index > 0) {
    const remainder = (index - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    index = Math.floor((index - 1) / 26);
  }
  return col;
}

// Get yesterday's date in Guyana timezone (UTC-4)
function getYesterdayGuyana() {
  const now = new Date();
  // Adjust for Guyana timezone (UTC-4)
  const guyanaTime = new Date(now.getTime() + (CONFIG.TIMEZONE_OFFSET * 60 * 60 * 1000));
  // Subtract one day
  guyanaTime.setDate(guyanaTime.getDate() - 1);
  // Return as YYYY-MM-DD
  return guyanaTime.toISOString().split('T')[0];
}

// Parse Excel date value (handles serial numbers, strings, Date objects)
function parseExcelDate(value) {
  if (!value) return null;

  // Already a Date object
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().split('T')[0];
  }

  // Excel serial number (days since 1899-12-30)
  if (typeof value === 'number' && value > 1 && value < 100000) {
    // Excel uses 1900 date system (with leap year bug)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().split('T')[0];
  }

  // String date - try various formats
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // ISO format: 2026-02-04
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // US format: 02/04/2026 or 2/4/2026
    const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usMatch) {
      const month = usMatch[1].padStart(2, '0');
      const day = usMatch[2].padStart(2, '0');
      return `${usMatch[3]}-${month}-${day}`;
    }

    // UK format: 04/02/2026 (day/month/year) - harder to distinguish
    // Try parsing with Date
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return null;
}

// Parse cell value and determine type
function parseCellValue(cell) {
  if (!cell) {
    return { raw: null, numeric: null, type: 'empty', error: null };
  }

  // Check for Excel errors
  if (cell.t === 'e') {
    const errorVal = cell.w || cell.v || 'ERROR';
    return { raw: errorVal, numeric: null, type: 'error', error: errorVal };
  }

  // Get the value (prefer computed value for formulas)
  const value = cell.v;
  const formatted = cell.w; // Formatted text

  if (value === null || value === undefined || value === '') {
    return { raw: null, numeric: null, type: 'empty', error: null };
  }

  // Number
  if (typeof value === 'number') {
    // Check if it's a percentage (cell format)
    if (cell.t === 'n' && formatted && formatted.includes('%')) {
      return { raw: formatted, numeric: value * 100, type: 'percentage', error: null };
    }
    return { raw: value, numeric: value, type: 'number', error: null };
  }

  // String - try to parse as number
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Empty after trim
    if (!trimmed) {
      return { raw: null, numeric: null, type: 'empty', error: null };
    }

    // Percentage string like "45%"
    if (trimmed.endsWith('%')) {
      const numPart = parseFloat(trimmed.slice(0, -1));
      if (!isNaN(numPart)) {
        return { raw: trimmed, numeric: numPart, type: 'percentage', error: null };
      }
    }

    // Currency string like "$1,234.56"
    const currencyMatch = trimmed.match(/^\$?([\d,]+\.?\d*)$/);
    if (currencyMatch) {
      const numVal = parseFloat(currencyMatch[1].replace(/,/g, ''));
      if (!isNaN(numVal)) {
        return { raw: trimmed, numeric: numVal, type: 'currency', error: null };
      }
    }

    // Plain number string
    const numVal = parseFloat(trimmed.replace(/,/g, ''));
    if (!isNaN(numVal)) {
      return { raw: trimmed, numeric: numVal, type: 'number', error: null };
    }

    // Text value
    return { raw: trimmed, numeric: null, type: 'text', error: null };
  }

  // Boolean
  if (typeof value === 'boolean') {
    return { raw: value.toString(), numeric: value ? 1 : 0, type: 'number', error: null };
  }

  return { raw: String(value), numeric: null, type: 'text', error: null };
}

// Get cell from sheet by address
function getCell(sheet, col, row) {
  const addr = `${col}${row}`;
  return sheet[addr];
}

// Get cell value from sheet
function getCellValue(sheet, col, row) {
  const cell = getCell(sheet, col, row);
  return cell ? (cell.v !== undefined ? cell.v : cell.w) : null;
}

/**
 * Find the column containing yesterday's date
 * @param {Object} sheet - XLSX worksheet
 * @returns {Object} - { column, date, exactMatch, lastDataColumn }
 */
function findYesterdayColumn(sheet) {
  const yesterday = getYesterdayGuyana();
  const headerRow = CONFIG.HEADER_ROW;
  const startColIndex = colToIndex(CONFIG.DATA_START_COLUMN);

  // Get sheet range
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const maxCol = range.e.c;

  let yesterdayColumn = null;
  let lastPopulatedColumn = null;
  let lastPopulatedDate = null;
  let foundDates = [];

  logger.info('Scanning for yesterday\'s date column', {
    yesterday,
    startCol: CONFIG.DATA_START_COLUMN,
    maxCol: indexToCol(maxCol)
  });

  // Scan columns from G onwards
  for (let colIdx = startColIndex; colIdx <= maxCol; colIdx++) {
    const colLetter = indexToCol(colIdx);
    const cellValue = getCellValue(sheet, colLetter, headerRow);

    if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
      const parsedDate = parseExcelDate(cellValue);

      if (parsedDate) {
        lastPopulatedColumn = colLetter;
        lastPopulatedDate = parsedDate;
        foundDates.push({ column: colLetter, date: parsedDate });

        if (parsedDate === yesterday) {
          yesterdayColumn = colLetter;
          logger.info('Found exact match for yesterday', { column: colLetter, date: parsedDate });
        }
      }
    }
  }

  // If exact match found
  if (yesterdayColumn) {
    return {
      column: yesterdayColumn,
      date: yesterday,
      exactMatch: true,
      lastDataColumn: lastPopulatedColumn,
      lastDataDate: lastPopulatedDate,
      scannedColumns: foundDates.length
    };
  }

  // No exact match - use last populated column
  if (lastPopulatedColumn) {
    return {
      column: lastPopulatedColumn,
      date: lastPopulatedDate,
      exactMatch: false,
      lastDataColumn: lastPopulatedColumn,
      lastDataDate: lastPopulatedDate,
      scannedColumns: foundDates.length,
      expectedDate: yesterday
    };
  }

  // No date columns found at all
  return {
    column: null,
    date: null,
    exactMatch: false,
    error: 'No date columns found in row 4',
    scannedColumns: 0
  };
}

/**
 * Extract metadata from columns A-F for rows 5-83
 * @param {Object} sheet - XLSX worksheet
 * @returns {Array} - Array of metadata objects by row
 */
function extractMetadata(sheet) {
  const metadata = [];

  for (let row = CONFIG.DATA_START_ROW; row <= CONFIG.DATA_END_ROW; row++) {
    const rowMeta = {
      row: row,
      metric_name: getCellValue(sheet, 'A', row),
      category: getCellValue(sheet, 'B', row),
      subcategory: getCellValue(sheet, 'C', row),
      agency: getCellValue(sheet, 'D', row),
      unit: getCellValue(sheet, 'E', row),
      extra: getCellValue(sheet, 'F', row)
    };

    // Clean up string values
    for (const key of Object.keys(rowMeta)) {
      if (typeof rowMeta[key] === 'string') {
        rowMeta[key] = rowMeta[key].trim();
      }
    }

    metadata.push(rowMeta);
  }

  return metadata;
}

/**
 * Extract data from a specific column for rows 5-83
 * @param {Object} sheet - XLSX worksheet
 * @param {string} column - Column letter
 * @param {Array} metadata - Row metadata
 * @returns {Object} - { records, stats }
 */
function extractColumnData(sheet, column, metadata) {
  const records = [];
  let emptyCount = 0;
  let errorCount = 0;
  let numericCount = 0;
  let textCount = 0;

  for (let i = 0; i < metadata.length; i++) {
    const row = CONFIG.DATA_START_ROW + i;
    const meta = metadata[i];
    const cell = getCell(sheet, column, row);
    const parsed = parseCellValue(cell);

    const record = {
      row: row,
      metric_name: meta.metric_name || `Row ${row}`,
      category: meta.category,
      subcategory: meta.subcategory,
      agency: meta.agency,
      unit: meta.unit,
      raw_value: parsed.raw,
      numeric_value: parsed.numeric,
      value_type: parsed.type,
      has_error: parsed.type === 'error',
      error_detail: parsed.error
    };

    records.push(record);

    // Stats
    switch (parsed.type) {
      case 'empty': emptyCount++; break;
      case 'error': errorCount++; break;
      case 'text': textCount++; break;
      default: numericCount++; break;
    }
  }

  return {
    records,
    stats: {
      total: records.length,
      empty: emptyCount,
      errors: errorCount,
      numeric: numericCount,
      text: textCount,
      emptyPercentage: Math.round((emptyCount / records.length) * 100)
    }
  };
}

/**
 * Main parsing function - parses the daily Excel file
 * @param {Buffer} buffer - Excel file buffer
 * @param {Object} options - Parsing options
 * @returns {Object} - Parsing result
 */
function parseDailyExcel(buffer, options = {}) {
  const startTime = Date.now();
  const warnings = [];

  try {
    // Validate buffer
    if (!buffer || buffer.length === 0) {
      return {
        success: false,
        error: 'Empty file buffer provided'
      };
    }

    // Read workbook with optimizations for large files
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: true,   // Number formats
      cellFormula: false, // Don't need formulas, just values
      sheetStubs: true,   // Include empty cells
      dense: false        // Use sparse representation for memory efficiency
    });

    // Get first sheet (or specified sheet)
    const sheetName = options.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return {
        success: false,
        error: `Sheet not found: ${sheetName}`,
        availableSheets: workbook.SheetNames
      };
    }

    logger.info('Parsing daily Excel file', {
      sheetName,
      sheetCount: workbook.SheetNames.length,
      bufferSize: buffer.length
    });

    // Step 1: Find yesterday's date column
    const dateResult = findYesterdayColumn(sheet);

    if (!dateResult.column) {
      return {
        success: false,
        error: dateResult.error || 'Could not find a valid date column',
        details: dateResult
      };
    }

    // Warn if date doesn't match exactly
    if (!dateResult.exactMatch) {
      warnings.push({
        type: 'DATE_MISMATCH',
        message: `Expected yesterday's date (${dateResult.expectedDate}) but found ${dateResult.date}`,
        detectedDate: dateResult.date,
        expectedDate: dateResult.expectedDate,
        column: dateResult.column
      });
    }

    // Step 2: Extract metadata from columns A-F
    const metadata = extractMetadata(sheet);

    // Step 3: Extract data from the target column
    const { records, stats } = extractColumnData(sheet, dateResult.column, metadata);

    // Warn if too many empty values
    if (stats.emptyPercentage > CONFIG.MAX_EMPTY_PERCENTAGE) {
      warnings.push({
        type: 'HIGH_EMPTY_RATE',
        message: `${stats.emptyPercentage}% of values are empty (threshold: ${CONFIG.MAX_EMPTY_PERCENTAGE}%)`,
        emptyCount: stats.empty,
        totalCount: stats.total
      });
    }

    // Warn if there are Excel errors
    if (stats.errors > 0) {
      warnings.push({
        type: 'EXCEL_ERRORS',
        message: `${stats.errors} cells contain Excel errors (#REF!, #N/A, etc.)`,
        errorCount: stats.errors
      });
    }

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      data: {
        date: dateResult.date,
        dateColumn: dateResult.column,
        exactDateMatch: dateResult.exactMatch,
        expectedDate: dateResult.expectedDate || dateResult.date,
        records: records,
        stats: stats,
        metadata: {
          sheetName,
          totalSheets: workbook.SheetNames.length,
          scannedColumns: dateResult.scannedColumns,
          lastDataColumn: dateResult.lastDataColumn,
          lastDataDate: dateResult.lastDataDate,
          processingTimeMs: processingTime
        }
      },
      warnings: warnings.length > 0 ? warnings : undefined
    };

  } catch (error) {
    logger.error('Failed to parse daily Excel file', { error: error.message, stack: error.stack });

    return {
      success: false,
      error: `Failed to parse Excel file: ${error.message}`,
      details: error.code || error.name
    };
  }
}

/**
 * Validate that a file is a valid Excel file
 * @param {Object} file - Multer file object
 * @returns {Object} - { valid, error }
 */
function validateExcelFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file extension
  const validExtensions = ['.xlsx', '.xls'];
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

  if (!validExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file type: ${ext}. Only .xlsx and .xls files are allowed`
    };
  }

  // Check MIME type
  const validMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];

  if (file.mimetype && !validMimeTypes.includes(file.mimetype)) {
    // Log warning but don't reject - MIME types can be unreliable
    logger.warn('Unexpected MIME type for Excel file', {
      mimetype: file.mimetype,
      filename: file.originalname
    });
  }

  // Check file size (warn if very large)
  const MAX_SIZE_MB = 50;
  const sizeMB = file.size / (1024 * 1024);

  if (sizeMB > MAX_SIZE_MB) {
    return {
      valid: false,
      error: `File too large: ${sizeMB.toFixed(1)}MB (maximum: ${MAX_SIZE_MB}MB)`
    };
  }

  return { valid: true };
}

module.exports = {
  parseDailyExcel,
  validateExcelFile,
  getYesterdayGuyana,
  parseExcelDate,
  CONFIG
};
