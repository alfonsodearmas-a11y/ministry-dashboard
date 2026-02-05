/**
 * Run multivariate forecast migration
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'ministry_dashboard',
  user: process.env.DB_USER || 'ministry_app',
  password: process.env.DB_PASSWORD
});

async function runMigration() {
  const client = await pool.connect();
  try {
    const sqlPath = path.join(__dirname, '../../database/multivariate_forecast_migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Running multivariate forecast migration...');
    await client.query(sql);
    console.log('Migration completed successfully!');

  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
