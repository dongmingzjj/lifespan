/**
 * Sync API Integration Tests
 *
 * Tests the complete sync flow including:
 * - Event upload (batch sync)
 * - Event download (incremental sync)
 * - Sync status
 * - Conflict resolution
 * - Authentication requirements
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../../index.js';
import { generateAccessToken } from '../../middleware/auth.js';
import { createTestUser, createTestDevice } from '../setup.js';

describe('Sync API', () => {
  let authToken: string;
  let userId: string;
  let deviceId: string;
  let testUserEmail: string;

  beforeEach(async () => {
    // Create test user and device before each test
    testUserEmail = `test${Date.now()}@example.com`;
    const user = await createTestUser({
      username: `testuser${Date.now()}`,
      email: testUserEmail,
      password: 'TestPassword123!',
    });
    userId = user.id;

    deviceId = await createTestDevice({
      userId: user.id,
      deviceName: 'Test Device',
      deviceType: 'windows',
    });

    authToken = generateAccessToken({
      sub: userId,
      device_id: deviceId,
    });
  });

  describe('POST /api/v1/sync/events', () => {
    it('should upload events successfully', async () => {
      const events = [
        {
          id: uuidv4(),
          event_type: 'app_usage',
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'encrypted_data_here_base64',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
          app_name: 'VSCode',
          category: 'work',
        },
      ];

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          events,
          last_sync_at: 0,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('synced_at');
      expect(response.body).toHaveProperty('processed_count');
      expect(response.body.processed_count).toBe(1);
      expect(response.body.conflicts).toEqual([]);
    });

    it('should upload multiple events in batch', async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({
        id: uuidv4(),
        event_type: 'app_usage',
        timestamp: Date.now() + i * 1000,
        duration: 60 * (i + 1),
        encrypted_data: `encrypted_data_${i}_base64`,
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag_here_16bytes_base',
        app_name: `App${i}`,
        category: 'work',
      }));

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          events,
          last_sync_at: 0,
        });

      expect(response.status).toBe(200);
      expect(response.body.processed_count).toBe(10);
    });

    it('should handle conflict with existing events (server newer)', async () => {
      const eventId = uuidv4();
      const olderTimestamp = Date.now() - 3600000; // 1 hour ago
      const newerTimestamp = Date.now();

      // Upload event with older timestamp
      await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          events: [
            {
              id: eventId,
              event_type: 'app_usage',
              timestamp: olderTimestamp,
              duration: 300,
              encrypted_data: 'old_encrypted_data',
              nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
              tag: 'auth_tag_here_16bytes_base',
              app_name: 'VSCode',
              category: 'work',
            },
          ],
          last_sync_at: 0,
        });

      // Try to upload same event with newer timestamp
      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          events: [
            {
              id: eventId,
              event_type: 'app_usage',
              timestamp: newerTimestamp,
              duration: 600,
              encrypted_data: 'new_encrypted_data',
              nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
              tag: 'auth_tag_here_16bytes_base',
              app_name: 'VSCode',
              category: 'work',
            },
          ],
          last_sync_at: olderTimestamp,
        });

      expect(response.status).toBe(200);
      expect(response.body.processed_count).toBe(1);
    });

    it('should reject upload without auth token', async () => {
      const response = await request(app)
        .post('/api/v1/sync/events')
        .send({
          events: [],
          last_sync_at: 0,
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should reject upload with invalid auth token', async () => {
      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', 'Bearer invalid_token')
        .send({
          events: [],
          last_sync_at: 0,
        });

      expect(response.status).toBe(401);
    });

    it('should reject upload with empty events array', async () => {
      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          events: [],
          last_sync_at: 0,
        });

      expect(response.status).toBe(400);
    });

    it('should reject upload with more than 100 events', async () => {
      const events = Array.from({ length: 101 }, () => ({
        id: uuidv4(),
        event_type: 'app_usage' as const,
        timestamp: Date.now(),
        duration: 300,
        encrypted_data: 'encrypted_data',
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag_here_16bytes_base',
      }));

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });

      expect(response.status).toBe(400);
    });

    it('should reject upload with invalid event type', async () => {
      const events = [
        {
          id: uuidv4(),
          event_type: 'invalid_type',
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });

      expect(response.status).toBe(400);
    });

    it('should reject upload with future timestamp', async () => {
      const events = [
        {
          id: uuidv4(),
          event_type: 'app_usage',
          timestamp: Date.now() + 120000, // 2 minutes in future
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });

      expect(response.status).toBe(400);
    });

    it('should reject upload with negative duration', async () => {
      const events = [
        {
          id: uuidv4(),
          event_type: 'app_usage',
          timestamp: Date.now(),
          duration: -100,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });

      expect(response.status).toBe(400);
    });

    it('should accept all valid event types', async () => {
      const eventTypes = ['app_usage', 'web_activity', 'file_activity', 'communication'] as const;

      for (const eventType of eventTypes) {
        const response = await request(app)
          .post('/api/v1/sync/events')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            events: [
              {
                id: uuidv4(),
                event_type: eventType,
                timestamp: Date.now(),
                duration: 300,
                encrypted_data: 'encrypted_data',
                nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
                tag: 'auth_tag_here_16bytes_base',
              },
            ],
            last_sync_at: 0,
          });

        expect(response.status).toBe(200);
      }
    });

    it('should accept all valid categories', async () => {
      const categories = ['work', 'communication', 'entertainment', 'learning', 'utility', 'other'] as const;

      for (const category of categories) {
        const response = await request(app)
          .post('/api/v1/sync/events')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            events: [
              {
                id: uuidv4(),
                event_type: 'app_usage',
                timestamp: Date.now(),
                duration: 300,
                encrypted_data: 'encrypted_data',
                nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
                tag: 'auth_tag_here_16bytes_base',
                category,
              },
            ],
            last_sync_at: 0,
          });

        expect(response.status).toBe(200);
      }
    });
  });

  describe('GET /api/v1/sync/events', () => {
    beforeEach(async () => {
      // Create some test events
      const events = Array.from({ length: 5 }, (_, i) => ({
        id: uuidv4(),
        event_type: 'app_usage' as const,
        timestamp: Date.now() - (5 - i) * 3600000, // Spread over 5 hours
        duration: 300 * (i + 1),
        encrypted_data: `encrypted_data_${i}`,
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag_here_16bytes_base',
        app_name: `App${i}`,
        category: 'work',
      }));

      await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });
    });

    it('should download events with default limit', async () => {
      const response = await request(app)
        .get('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('has_more');
      expect(response.body).toHaveProperty('latest_timestamp');
      expect(Array.isArray(response.body.events)).toBe(true);
      expect(response.body.events.length).toBeLessThanOrEqual(100);
    });

    it('should download events with custom limit', async () => {
      const response = await request(app)
        .get('/api/v1/sync/events?limit=3')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.events.length).toBe(3);
      expect(response.body.has_more).toBe(true);
    });

    it('should download events filtered by since timestamp', async () => {
      const since = Date.now() - 3600000; // 1 hour ago

      const response = await request(app)
        .get(`/api/v1/sync/events?since=${since}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      // All events with timestamp > since should be returned
      response.body.events.forEach((event: any) => {
        expect(event.timestamp).toBeGreaterThan(since);
      });
    });

    it('should respect maximum limit of 1000', async () => {
      const response = await request(app)
        .get('/api/v1/sync/events?limit=10000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      // Should default to max 1000
      expect(response.body.events.length).toBeLessThanOrEqual(1000);
    });

    it('should reject download without auth token', async () => {
      const response = await request(app)
        .get('/api/v1/sync/events');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('should reject download with invalid limit', async () => {
      const response = await request(app)
        .get('/api/v1/sync/events?limit=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
    });

    it('should reject download with negative since', async () => {
      const response = await request(app)
        .get('/api/v1/sync/events?since=-100')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/sync/status', () => {
    beforeEach(async () => {
      // Create some test events
      const events = [
        {
          id: uuidv4(),
          event_type: 'app_usage' as const,
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });
    });

    it('should get sync status', async () => {
      const response = await request(app)
        .get('/api/v1/sync/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('device_id');
      expect(response.body).toHaveProperty('last_sync_at');
      expect(response.body).toHaveProperty('pending_count');
      expect(response.body).toHaveProperty('synced_count');
      expect(response.body.synced_count).toBeGreaterThan(0);
    });

    it('should reject status request without auth token', async () => {
      const response = await request(app)
        .get('/api/v1/sync/status');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });
  });

  describe('Sync End-to-End Flow', () => {
    it('should complete full bidirectional sync cycle', async () => {
      // Step 1: Upload events from client
      const uploadEvents = Array.from({ length: 5 }, (_, i) => ({
        id: uuidv4(),
        event_type: 'app_usage' as const,
        timestamp: Date.now() + i * 1000,
        duration: 300 * (i + 1),
        encrypted_data: `encrypted_${i}`,
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag_here_16bytes_base',
        app_name: `App${i}`,
        category: 'work',
      }));

      const uploadResponse = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          events: uploadEvents,
          last_sync_at: 0,
        });

      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.body.processed_count).toBe(5);

      // Step 2: Get sync status
      const statusResponse = await request(app)
        .get('/api/v1/sync/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.synced_count).toBe(5);

      // Step 3: Download events (incremental sync)
      const since = uploadResponse.body.synced_at;
      const downloadResponse = await request(app)
        .get(`/api/v1/sync/events?since=${since}&limit=10`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(downloadResponse.status).toBe(200);
      expect(Array.isArray(downloadResponse.body.events)).toBe(true);
      expect(downloadResponse.body).toHaveProperty('has_more');
      expect(downloadResponse.body).toHaveProperty('latest_timestamp');
    });

    it('should handle concurrent uploads from multiple devices', async () => {
      // Create second device
      const device2Id = await createTestDevice({
        userId,
        deviceName: 'Second Device',
        deviceType: 'android',
      });

      const authToken2 = generateAccessToken({
        sub: userId,
        device_id: device2Id,
      });

      // Upload from device 1
      const events1 = [
        {
          id: uuidv4(),
          event_type: 'app_usage' as const,
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'device1_event',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      const response1 = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events: events1, last_sync_at: 0 });

      expect(response1.status).toBe(200);

      // Upload from device 2
      const events2 = [
        {
          id: uuidv4(),
          event_type: 'web_activity' as const,
          timestamp: Date.now(),
          duration: 500,
          encrypted_data: 'device2_event',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      const response2 = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ events: events2, last_sync_at: 0 });

      expect(response2.status).toBe(200);

      // Both devices should see all events
      const download1 = await request(app)
        .get('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`);

      expect(download1.body.events.length).toBe(2);

      const download2 = await request(app)
        .get('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(download2.body.events.length).toBe(2);
    });
  });
});
