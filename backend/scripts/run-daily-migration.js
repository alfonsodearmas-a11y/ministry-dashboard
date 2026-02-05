#!/usr/bin/env node
/**
 * Run the daily metrics migration
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ministry_dashboard',
  user: process.env.DB_USER || 'ministry_app',
  password: process.env.DB_PASSWORD,
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Connected to database');
    console.log('Running daily metrics migration...\n');

    // Read the migration file
    const migrationPath = path.join(__dirname, '../../database/daily_metrics_migration.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolons and run each statement
    // Filter out empty statements and comments-only blocks
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^--.*$/));

    let successCount = 0;
    let skipCount = 0;

    for (const statement of statements) {
      if (!statement || statement.match(/^[\s\-]*$/)) continue;

      try {
        await client.query(statement);
        successCount++;

        // Extract object name for logging
        const match = statement.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|INDEX|FUNCTION|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i);
        if (match) {
          console.log(`  ✓ Created: ${match[1]}`);
        }
      } catch (err) {
        if (err.code === '42P07') { // duplicate_table
          skipCount++;
          const match = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i);
          console.log(`  - Skipped (exists): ${match ? match[1] : 'object'}`);
        } else if (err.code === '42710') { // duplicate_object (trigger, etc)
          skipCount++;
          console.log(`  - Skipped (exists): trigger/function`);
        } else {
          console.error(`  ✗ Error: ${err.message}`);
        }
      }
    }

    console.log(`\n✓ Migration complete: ${successCount} created, ${skipCount} skipped`);

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
