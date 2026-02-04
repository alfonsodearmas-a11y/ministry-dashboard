const XLSX = require('xlsx');

/**
 * Parse GPL DBIS Excel file (DBIS Availability Generating Capacity.xlsx)
 *
 * Expected structure:
 * - Sheet: "Generation Status"
 * - Rows 4-40: Station/unit data
 * - Row 41: Total Capacity
 * - Row 42: Expected Peak Demand
 * - Row 43: Reserve Capacity
 * - Row 49: Report date
 */

// Station mapping from Excel names to our codes
const STATION_MAP = {
  'SEI': 'SEI',
  'Canefield': 'CANEFIELD',
  'Onverwagt': 'ONVERWAGT',
  'GOE': 'GOE',
  'DP1': 'DP1',
  'DP2': 'DP2',
  'DP3': 'DP3',
  'DP4': 'DP4',
  'DP5': 'DP5',
};

function parseGPLExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  // Get the Generation Status sheet
  const sheetName = workbook.SheetNames.find(name =>
    name.toLowerCase().includes('generation') || name.toLowerCase().includes('status')
  ) || workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Parse station data (rows 4-40, 0-indexed)
  const stationData = {};
  let currentStation = null;

  for (let i = 4; i <= 40; i++) {
    const row = data[i];
    if (!row) continue;

    // Column 0 has station name (only on first unit of each station)
    if (row[0] && typeof row[0] === 'string') {
      const stationName = row[0].trim();
      currentStation = STATION_MAP[stationName] || stationName.toUpperCase();
    }

    if (!currentStation) continue;

    // Column 2 has unit number, columns 5-6 have available MW
    const unitNo = row[2];
    const deratedMW = parseFloat(row[4]) || 0;
    const availableMW = parseFloat(row[5]) || parseFloat(row[6]) || 0;

    if (unitNo !== null && unitNo !== undefined) {
      if (!stationData[currentStation]) {
        stationData[currentStation] = {
          units: 0,
          derated_mw: 0,
          available_mw: 0,
          unit_details: []
        };
      }

      stationData[currentStation].units += 1;
      stationData[currentStation].derated_mw += deratedMW;
      stationData[currentStation].available_mw += availableMW;
      stationData[currentStation].unit_details.push({
        unit: unitNo,
        derated_mw: deratedMW,
        available_mw: availableMW
      });
    }
  }

  // Round station totals
  for (const station of Object.keys(stationData)) {
    stationData[station].derated_mw = Math.round(stationData[station].derated_mw * 100) / 100;
    stationData[station].available_mw = Math.round(stationData[station].available_mw * 100) / 100;
  }

  // Parse summary rows (41-47)
  const summaries = {};
  const summaryLabels = {
    41: 'totalCapacity',
    42: 'expectedPeakDemand',
    43: 'reserveCapacity',
    44: 'averageFOR',
    45: 'expectedCapacity',
    46: 'expectedReserve',
    47: 'actualPeakDemand'
  };

  for (const [rowIdx, key] of Object.entries(summaryLabels)) {
    const row = data[parseInt(rowIdx)];
    if (row) {
      summaries[key] = parseFloat(row[5]) || parseFloat(row[6]) || null;
    }
  }

  // Parse report date (row 49, column 3)
  let reportDate = null;
  if (data[49] && data[49][3]) {
    const dateVal = data[49][3];
    if (dateVal instanceof Date) {
      reportDate = dateVal.toISOString().split('T')[0];
    } else if (typeof dateVal === 'string') {
      reportDate = new Date(dateVal).toISOString().split('T')[0];
    } else if (typeof dateVal === 'number') {
      // Excel serial date
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + dateVal * 86400000);
      reportDate = date.toISOString().split('T')[0];
    }
  }

  // If no date found in row 49, try row 3 column 5 or 6 (header date)
  if (!reportDate && data[3]) {
    const headerDate = data[3][5] || data[3][6];
    if (headerDate instanceof Date) {
      reportDate = headerDate.toISOString().split('T')[0];
    } else if (typeof headerDate === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + headerDate * 86400000);
      reportDate = date.toISOString().split('T')[0];
    }
  }

  // Calculate totals
  let totalFossilCapacity = 0;
  for (const station of Object.values(stationData)) {
    totalFossilCapacity += station.available_mw;
  }

  return {
    success: true,
    data: {
      reportDate,
      stationData,
      summaries: {
        totalCapacity: summaries.totalCapacity || totalFossilCapacity,
        expectedPeakDemand: summaries.expectedPeakDemand,
        reserveCapacity: summaries.reserveCapacity,
        actualPeakDemand: summaries.actualPeakDemand,
      },
      // Format for GPL DBIS API
      apiPayload: {
        reportDate,
        stationData: Object.fromEntries(
          Object.entries(stationData).map(([code, data]) => [
            code,
            {
              units: data.units,
              derated_mw: data.derated_mw,
              available_mw: data.available_mw
            }
          ])
        ),
        eveningPeakOnbars: summaries.expectedPeakDemand,
        generationAvailability: totalFossilCapacity,
        // Solar defaults (not in this Excel)
        hampshireSolarMwp: 0,
        prospectSolarMwp: 0,
        trafalgarSolarMwp: 0,
      },
      meta: {
        sheetName,
        stationCount: Object.keys(stationData).length,
        totalUnits: Object.values(stationData).reduce((sum, s) => sum + s.units, 0),
        calculatedTotalMW: Math.round(totalFossilCapacity * 100) / 100
      }
    }
  };
}

module.exports = { parseGPLExcel };
