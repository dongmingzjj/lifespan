/**
 * Test Database Setup Script
 *
 * This script creates a test database schema for integration tests.
 * Run this before running integration tests.
 */

import { createDatabase, query, closeDatabase } from '../../utils/database.js';

const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5432', 10),
  database: process.env.TEST_DB_NAME || 'lifespan_test',
  user: process.env.TEST_DB_USER || 'lifespan_test',
  password: process.env.TEST_DB_PASSWORD || 'lifespan_test',
};

/**
 * Create test database schema
 */
async function setupTestSchema(): Promise<void> {
  try {
    // Create database connection
    createDatabase(TEST_DB_CONFIG);

    console.log('Creating test database schema...');

    // Create users table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_verified BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table created');

    // Create devices table
    await query(`
      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_name VARCHAR(100) NOT NULL,
        device_type VARCHAR(20) NOT NULL,
        device_id VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, device_id)
      )
    `);
    console.log('✅ Devices table created');

    // Create events table
    await query(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        event_type VARCHAR(20) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        duration INTEGER NOT NULL,
        encrypted_data TEXT NOT NULL,
        iv VARCHAR(47) NOT NULL,
        auth_tag VARCHAR(44),
        app_name VARCHAR(255),
        category VARCHAR(20),
        domain VARCHAR(255),
        synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Events table created');

    // Create sync_records table
    await query(`
      CREATE TABLE IF NOT EXISTS sync_records (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        sync_type VARCHAR(10) NOT NULL,
        events_count INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Sync records table created');

    // Create indexes for performance
    await query('CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)');
    await query('CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_sync_records_user_id ON sync_records(user_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id)');

    console.log('✅ Indexes created');

    console.log('✅ Test database schema setup complete!');
  } catch (error) {
    console.error('❌ Failed to setup test schema:', error);
    throw error;
  }
}

/**
 * Drop test database schema
 */
async function dropTestSchema(): Promise<void> {
  try {
    // Drop tables in correct order due to foreign keys
    await query('DROP TABLE IF EXISTS sync_records CASCADE');
    await query('DROP TABLE IF EXISTS events CASCADE');
    await query('DROP TABLE IF EXISTS devices CASCADE');
    await query('DROP TABLE IF EXISTS users CASCADE');

    console.log('✅ Test database schema dropped');
  } catch (error) {
    console.error('❌ Failed to drop test schema:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2];

  try {
    if (command === 'setup') {
      await setupTestSchema();
    } else if (command === 'teardown') {
      await dropTestSchema();
    } else if (command === 'reset') {
      await dropTestSchema();
      await setupTestSchema();
    } else {
      console.log('Usage: npm run test:db [setup|teardown|reset]');
      console.log('  setup     - Create test database schema');
      console.log('  teardown  - Drop test database schema');
      console.log('  reset     - Drop and recreate test database schema');
    }
  } finally {
    await closeDatabase();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { setupTestSchema, dropTestSchema };
