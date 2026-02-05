#!/usr/bin/env node
/**
 * Analyzes the GPL DBIS Excel file structure
 */

const XLSX = require('xlsx');
const path = require('path');

const filePath = process.argv[2] || '/Users/alfonsodearmas/Downloads/DBIS Availability Generating Capacity.xlsx';

console.log('Analyzing:', filePath);
console.log('='.repeat(80));

const workbook = XLSX.read(require('fs').readFileSync(filePath), { type: 'buffer', cellDates: true });

console.log('\nSheets:', workbook.SheetNames);

for (const sheetName of workbook.SheetNames) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Sheet: ${sheetName}`);
  console.log('='.repeat(80));

  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Print first 60 rows with row numbers
  for (let i = 0; i < Math.min(data.length, 70); i++) {
    const row = data[i];
    if (row && row.some(cell => cell !== '')) {
      // Format cells, truncating long values
      const formattedCells = row.map((cell, j) => {
        if (cell === null || cell === undefined || cell === '') return '_';
        if (cell instanceof Date) return cell.toISOString().split('T')[0];
        const str = String(cell);
        return str.length > 15 ? str.substring(0, 12) + '...' : str;
      });
      console.log(`Row ${String(i).padStart(2)}: [${formattedCells.slice(0, 10).join(' | ')}]`);
    }
  }
}
