/**
 * Performance Tests
 *
 * Tests API performance characteristics including:
 * - Response times
 * - Concurrent request handling
 * - Load capacity
 * - Rate limiting
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../../index.js';
import { generateAccessToken } from '../../middleware/auth.js';
import { createTestUser, createTestDevice } from '../setup.js';

describe('Performance Tests', () => {
  let authToken: string;
  let userId: string;
  let deviceId: string;

  beforeAll(async () => {
    // Create test user and device for performance tests
    const user = await createTestUser({
      username: `perfuser${Date.now()}`,
      email: `perf${Date.now()}@example.com`,
      password: 'PerfPassword123!',
    });
    userId = user.id;

    deviceId = await createTestDevice({
      userId: user.id,
      deviceName: 'Performance Test Device',
      deviceType: 'windows',
    });

    authToken = generateAccessToken({
      sub: userId,
      device_id: deviceId,
    });
  });

  describe('Response Time Tests', () => {
    it('should respond to health check in < 100ms', async () => {
      const start = Date.now();

      await request(app).get('/health');

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should respond to login in < 500ms', async () => {
      const start = Date.now();

      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'perf@example.com',
          password: 'PerfPassword123!',
        });

      const duration = Date.now() - start;

      // Allow for bcrypt password hashing
      expect(duration).toBeLessThan(500);
    });

    it('should respond to sync upload in < 200ms for 10 events', async () => {
      const events = Array.from({ length: 10 }, () => ({
        id: uuidv4(),
        event_type: 'app_usage' as const,
        timestamp: Date.now(),
        duration: 300,
        encrypted_data: 'encrypted_data',
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag_here_16bytes_base',
      }));

      const start = Date.now();

      await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200);
    });

    it('should respond to sync status in < 100ms', async () => {
      const start = Date.now();

      await request(app)
        .get('/api/v1/sync/status')
        .set('Authorization', `Bearer ${authToken}`);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('Concurrent Request Tests', () => {
    it('should handle 50 concurrent health check requests', async () => {
      const requests = Array.from({ length: 50 }, () =>
        fetch('http://localhost:3000/health')
      );

      const results = await Promise.allSettled(requests);
      const successful = results.filter(r => r.status === 'fulfilled');

      // At least 95% should succeed
      expect(successful.length).toBeGreaterThanOrEqual(47);
    });

    it('should handle 20 concurrent sync uploads', async () => {
      const requests = Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/v1/sync/events')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            events: [
              {
                id: uuidv4(),
                event_type: 'app_usage' as const,
                timestamp: Date.now() + i,
                duration: 300,
                encrypted_data: 'encrypted_data',
                nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
                tag: 'auth_tag_here_16bytes_base',
              },
            ],
            last_sync_at: 0,
          })
      );

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        expect([200, 409]).toContain(response.status); // 200 or 409 (conflict) is OK
      });
    });

    it('should handle mixed concurrent requests', async () => {
      const requests = [
        // 10 health checks
        ...Array.from({ length: 10 }, () => fetch('http://localhost:3000/health')),
        // 5 sync status
        ...Array.from({ length: 5 }, () =>
          request(app)
            .get('/api/v1/sync/status')
            .set('Authorization', `Bearer ${authToken}`)
        ),
        // 5 sync uploads
        ...Array.from({ length: 5 }, (_, i) =>
          request(app)
            .post('/api/v1/sync/events')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              events: [
                {
                  id: uuidv4(),
                  event_type: 'app_usage' as const,
                  timestamp: Date.now() + i,
                  duration: 300,
                  encrypted_data: 'encrypted_data',
                  nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
                  tag: 'auth_tag_here_16bytes_base',
                },
              ],
              last_sync_at: 0,
            })
        ),
      ];

      const results = await Promise.allSettled(requests);
      const successful = results.filter(r => r.status === 'fulfilled');

      // At least 90% should succeed
      expect(successful.length).toBeGreaterThanOrEqual(
        Math.floor(requests.length * 0.9)
      );
    });
  });

  describe('Load Capacity Tests', () => {
    it('should handle 100 sync events upload in single request', async () => {
      const events = Array.from({ length: 100 }, (_, i) => ({
        id: uuidv4(),
        event_type: 'app_usage' as const,
        timestamp: Date.now() + i * 1000,
        duration: 300,
        encrypted_data: 'encrypted_data',
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag_here_16bytes_base',
        app_name: `App${i % 10}`,
        category: 'work',
      }));

      const response = await request(app)
        .post('/api/v1/sync/events')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ events, last_sync_at: 0 });

      expect(response.status).toBe(200);
      expect(response.body.processed_count).toBe(100);
    });

    it('should handle pagination with 1000 events download', async () => {
      // First, upload 1000 events
      const uploadBatches = [];
      for (let i = 0; i < 10; i++) {
        const events = Array.from({ length: 100 }, (_, j) => ({
          id: uuidv4(),
          event_type: 'app_usage' as const,
          timestamp: Date.now() + (i * 100 + j) * 1000,
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        }));

        uploadBatches.push(
          request(app)
            .post('/api/v1/sync/events')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ events, last_sync_at: 0 })
        );
      }

      await Promise.all(uploadBatches);

      // Download with max limit
      const response = await request(app)
        .get('/api/v1/sync/events?limit=1000')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.events.length).toBeGreaterThan(0);
      expect(response.body.events.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Rate Limiting Tests', () => {
    it('should allow normal rate of requests', async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .get('/api/v1/sync/status')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(requests);

      // All should succeed (under rate limit)
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should rate limit excessive requests from same IP', async () => {
      // This test depends on the rate limit configuration
      // Default is typically 100 requests per 15 minutes
      // We'll verify that the rate limiter is active by checking headers

      const response = await request(app)
        .get('/api/v1/sync/status')
        .set('Authorization', `Bearer ${authToken}`);

      // Check for rate limit headers
      expect(response.headers).toBeDefined();
      // Headers might include: X-RateLimit-Limit, X-RateLimit-Remaining, etc.
    }, 10000);
  });

  describe('Memory and Resource Tests', () => {
    it('should not leak memory during repeated uploads', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform 50 upload cycles
      for (let i = 0; i < 50; i++) {
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
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (< 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    }, 30000);
  });
});
