#!/usr/bin/env node
/**
 * Creates a test GPL user for local development
 * Run with: node scripts/create-test-user.js
 * Requires the SSH tunnel to be running: npm run tunnel
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'ministry_dashboard',
  user: process.env.DB_USER || 'ministry_app',
  password: process.env.DB_PASSWORD,
});

async function createTestUser() {
  const client = await pool.connect();

  try {
    // Check if user already exists
    const existing = await client.query(
      'SELECT id, username, agency FROM users WHERE username = $1',
      ['gpl_admin']
    );

    if (existing.rows.length > 0) {
      console.log('User gpl_admin already exists:', existing.rows[0]);
      return;
    }

    // Create test user
    const password = 'gpl2024';
    const hash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `INSERT INTO users (username, email, full_name, password_hash, role, agency, status, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, username, email, role, agency`,
      ['gpl_admin', 'gpl@ministry.gov.gy', 'GPL Administrator', hash, 'data_entry', 'gpl', 'active', true]
    );

    console.log('Created test user:', result.rows[0]);
    console.log('Login with: gpl_admin / gpl2024');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createTestUser();
