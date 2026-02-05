#!/usr/bin/env node
const XLSX = require('xlsx');
const filePath = '/Users/alfonsodearmas/Downloads/DBIS Availability Generating Capacity.xlsx';

const workbook = XLSX.read(require('fs').readFileSync(filePath), { type: 'buffer', cellDates: true });

// Check Schedule sheet for more rows (solar data, etc.)
const sheet = workbook.Sheets['Schedule'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

console.log('Schedule sheet - rows 65-90:');
for (let i = 65; i < Math.min(data.length, 100); i++) {
  const row = data[i];
  if (row && row.some(cell => cell !== '')) {
    const formattedCells = row.map((cell, j) => {
      if (cell === null || cell === undefined || cell === '') return '_';
      if (cell instanceof Date) return cell.toISOString().split('T')[0];
      const str = String(cell);
      return str.length > 20 ? str.substring(0, 17) + '...' : str;
    });
    console.log(`Row ${String(i).padStart(2)}: [${formattedCells.slice(0, 10).join(' | ')}]`);
  }
}

// Also check Generation Status for more rows
const genSheet = workbook.Sheets['Generation Status'];
const genData = XLSX.utils.sheet_to_json(genSheet, { header: 1, defval: '' });
console.log('\n\nGeneration Status sheet - full scan for solar/summary:');
for (let i = 0; i < genData.length; i++) {
  const row = genData[i];
  const rowStr = row.join(' ').toLowerCase();
  if (rowStr.includes('solar') || rowStr.includes('hampshire') || rowStr.includes('prospect') ||
      rowStr.includes('trafalgar') || rowStr.includes('renewable') || rowStr.includes('dbis') ||
      rowStr.includes('evening') || rowStr.includes('suppressed') || rowStr.includes('power ship') ||
      rowStr.includes('col') || rowStr.includes('fossil')) {
    const formattedCells = row.map(cell => {
      if (cell === null || cell === undefined || cell === '') return '_';
      if (cell instanceof Date) return cell.toISOString().split('T')[0];
      return String(cell).substring(0, 20);
    });
    console.log(`Row ${String(i).padStart(2)}: [${formattedCells.slice(0, 8).join(' | ')}]`);
  }
}
