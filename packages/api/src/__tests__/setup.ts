/**
 * Test Setup Configuration
 *
 * This file sets up the test environment including:
 * - Test database connection
 * - Global test fixtures
 * - Test utilities
 */

import { createDatabase, closeDatabase, query } from '../utils/database.js';

// Test database configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5432', 10),
  database: process.env.TEST_DB_NAME || 'lifespan_test',
  user: process.env.TEST_DB_USER || 'lifespan_test',
  password: process.env.TEST_DB_PASSWORD || 'lifespan_test',
  max: 5, // Smaller pool for tests
};

let isConnected = false;

/**
 * Initialize test database connection
 */
export async function setupTestDatabase(): Promise<void> {
  if (isConnected) {
    return;
  }

  try {
    createDatabase(TEST_DB_CONFIG);

    // Test connection
    await query('SELECT 1');
    isConnected = true;

    console.log('✅ Test database connected');
  } catch (error) {
    console.error('❌ Failed to connect to test database:', error);
    throw error;
  }
}

/**
 * Clean up test database connection
 */
export async function teardownTestDatabase(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await closeDatabase();
    isConnected = false;

    console.log('✅ Test database disconnected');
  } catch (error) {
    console.error('❌ Failed to disconnect test database:', error);
    throw error;
  }
}

/**
 * Clean all test data from database
 * This runs after each test to ensure isolation
 */
export async function cleanupTestData(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    // Delete in correct order due to foreign key constraints
    await query('DELETE FROM sync_records');
    await query('DELETE FROM events');
    await query('DELETE FROM devices');
    await query('DELETE FROM users');
  } catch (error) {
    console.error('❌ Failed to cleanup test data:', error);
    throw error;
  }
}

/**
 * Create test user fixtures
 */
export async function createTestUser(userData: {
  username: string;
  email: string;
  password: string;
}): Promise<{ id: string; username: string; email: string }> {
  const bcrypt = await import('bcrypt');
  const { v4: uuidv4 } = await import('uuid');

  const passwordHash = await bcrypt.hash(userData.password, 12);
  const userId = uuidv4();

  const result = await query(
    `INSERT INTO users (id, username, email, password_hash, is_verified, created_at)
     VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
     RETURNING id, username, email`,
    [userId, userData.username, userData.email, passwordHash]
  );

  return result.rows[0];
}

/**
 * Create test device fixture
 */
export async function createTestDevice(deviceData: {
  userId: string;
  deviceName: string;
  deviceType: string;
}): Promise<string> {
  const { v4: uuidv4 } = await import('uuid');

  const deviceId = uuidv4();
  const result = await query(
    `INSERT INTO devices (id, user_id, device_name, device_type, is_active, created_at)
     VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
     RETURNING id`,
    [deviceId, deviceData.userId, deviceData.deviceName, deviceData.deviceType]
  );

  return result.rows[0].id;
}

/**
 * Create test event fixture
 */
export async function createTestEvent(eventData: {
  userId: string;
  deviceId: string;
  eventType: string;
  timestamp: Date;
  duration: number;
  encryptedData: string;
}): Promise<string> {
  const { v4: uuidv4 } = await import('uuid');

  const eventId = uuidv4();
  const result = await query(
    `INSERT INTO events (
      id, user_id, device_id, event_type, timestamp, duration,
      encrypted_data, iv, auth_tag, app_name, category, synced_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
    ) RETURNING id`,
    [
      eventId,
      eventData.userId,
      eventData.deviceId,
      eventData.eventType,
      eventData.timestamp,
      eventData.duration,
      eventData.encryptedData,
      'a1b2c3d4e5f6a1b2c3d4e5f6',
      'auth_tag_here_16bytes_base64',
      'TestApp',
      'work',
    ]
  );

  return result.rows[0].id;
}

// Global setup
beforeAll(async () => {
  await setupTestDatabase();
});

// Global teardown
afterAll(async () => {
  await teardownTestDatabase();
});

// Cleanup after each test
afterEach(async () => {
  await cleanupTestData();
});
