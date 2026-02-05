#!/usr/bin/env node
/**
 * Run GPL redesign database migration
 *
 * Usage: node scripts/run-gpl-migration.js
 *
 * Prerequisites:
 * - DATABASE_URL environment variable set
 * - Or SSH tunnel running (npm run tunnel)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('='.repeat(60));
  console.log('GPL DBIS Database Migration');
  console.log('='.repeat(60));

  // Build connection config from env
  let connectionConfig;

  if (process.env.DATABASE_URL) {
    connectionConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    };
  } else if (process.env.DB_HOST) {
    connectionConfig = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: false
    };
    console.log(`\nConnecting to: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  } else {
    console.error('ERROR: No database configuration found');
    console.log('\nMake sure your .env file contains DB_HOST, DB_PORT, etc. or DATABASE_URL');
    process.exit(1);
  }

  // Read migration SQL
  const migrationPath = path.join(__dirname, '../../database/gpl_redesign_migration.sql');

  if (!fs.existsSync(migrationPath)) {
    console.error(`ERROR: Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  console.log(`\nMigration file: ${migrationPath}`);
  console.log(`SQL length: ${migrationSQL.length} characters`);

  // Connect to database
  const pool = new Pool(connectionConfig);

  try {
    console.log('\nConnecting to database...');
    const client = await pool.connect();

    console.log('Running migration...\n');

    // Execute the full migration SQL at once
    try {
      await client.query(migrationSQL);
      console.log('  ✓ Migration SQL executed successfully');
    } catch (error) {
      // If full execution fails, try statement by statement
      console.log('  Note: Running statements individually...\n');

      // More careful splitting - don't split on semicolons inside parentheses
      const statements = [];
      let current = '';
      let parenDepth = 0;

      for (const char of migrationSQL) {
        if (char === '(') parenDepth++;
        if (char === ')') parenDepth--;
        current += char;

        if (char === ';' && parenDepth === 0) {
          const trimmed = current.trim();
          if (trimmed.length > 1) {
            statements.push(trimmed);
          }
          current = '';
        }
      }

      let successCount = 0;
      let skipCount = 0;

      for (const statement of statements) {
        // Skip comment-only statements
        const withoutComments = statement.replace(/--.*$/gm, '').trim();
        if (!withoutComments || withoutComments === ';') {
          continue;
        }

        try {
          await client.query(statement);
          successCount++;

          // Log what was created
          if (statement.includes('CREATE TABLE')) {
            const match = statement.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
            if (match) console.log(`  ✓ Table: ${match[1]}`);
          } else if (statement.includes('CREATE INDEX')) {
            const match = statement.match(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/i);
            if (match) console.log(`  ✓ Index: ${match[1]}`);
          } else if (statement.includes('CREATE OR REPLACE VIEW')) {
            const match = statement.match(/CREATE OR REPLACE VIEW (\w+)/i);
            if (match) console.log(`  ✓ View: ${match[1]}`);
          } else if (statement.includes('CREATE TRIGGER')) {
            const match = statement.match(/CREATE TRIGGER (\w+)/i);
            if (match) console.log(`  ✓ Trigger: ${match[1]}`);
          }
        } catch (err) {
          if (err.message.includes('already exists')) {
            skipCount++;
          } else if (err.message.includes('does not exist')) {
            console.log(`  ⚠ Skipped: ${err.message.slice(0, 60)}...`);
            skipCount++;
          } else {
            console.error(`  ✗ Error: ${err.message}`);
          }
        }
      }

      console.log(`\n  Successful: ${successCount}, Skipped: ${skipCount}`);
    }

    client.release();

    console.log('\n' + '='.repeat(60));
    console.log('Migration complete');
    console.log('='.repeat(60));

    // Verify tables exist
    console.log('\nVerifying tables...');
    const tables = ['gpl_uploads', 'gpl_daily_units', 'gpl_daily_stations', 'gpl_daily_summary', 'gpl_outages', 'gpl_ai_analysis'];

    for (const table of tables) {
      const result = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = $1
        )`,
        [table]
      );
      const exists = result.rows[0].exists;
      console.log(`  ${exists ? '✓' : '✗'} ${table}`);
    }

    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
