#!/usr/bin/env node
const fs = require('fs');
const { parseGPLExcel } = require('../src/services/excelParser');

const filePath = '/Users/alfonsodearmas/Downloads/DBIS Availability Generating Capacity.xlsx';
const buffer = fs.readFileSync(filePath);

const result = parseGPLExcel(buffer);

if (!result.success) {
  console.error('Parse failed:', result.error);
  process.exit(1);
}

console.log('=== PARSE RESULT ===\n');
console.log('Report Date:', result.data.reportDate);
console.log('\n=== STATIONS ===');
for (const [name, data] of Object.entries(result.data.stationData)) {
  console.log(`${name}: ${data.units} units, ${data.available_mw} MW available`);
}

console.log('\n=== SUMMARIES ===');
console.log(JSON.stringify(result.data.summaries, null, 2));

console.log('\n=== META ===');
console.log(JSON.stringify(result.data.meta, null, 2));
