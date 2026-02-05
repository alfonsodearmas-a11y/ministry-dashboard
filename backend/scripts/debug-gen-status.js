#!/usr/bin/env node
const XLSX = require('xlsx');
const filePath = '/Users/alfonsodearmas/Downloads/DBIS Availability Generating Capacity.xlsx';

const workbook = XLSX.read(require('fs').readFileSync(filePath), { type: 'buffer', cellDates: true });
const sheet = workbook.Sheets['Generation Status'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

console.log('=== ROW 0-3 (Headers) ===');
for (let i = 0; i <= 3; i++) {
  console.log(`Row ${i}:`, data[i]?.slice(0, 10));
}

console.log('\n=== STATION DATA (columns 0-7) ===');
for (let i = 4; i < 60; i++) {
  const row = data[i];
  if (!row) continue;
  if (row.some(cell => cell !== null && cell !== '')) {
    const cells = row.slice(0, 8).map((cell, idx) => {
      if (cell === null || cell === undefined) return 'NULL';
      if (cell === '') return 'EMPTY';
      if (cell instanceof Date) return cell.toISOString().split('T')[0];
      if (typeof cell === 'number') return cell.toFixed(2);
      return String(cell).substring(0, 15);
    });
    console.log(`Row ${String(i).padStart(2)}: ${cells.join(' | ')}`);
  }
}
