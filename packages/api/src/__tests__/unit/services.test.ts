/**
 * Sync Service Unit Tests
 *
 * Tests the business logic of the sync service including:
 * - Event upload logic
 * - Event download logic
 * - Conflict resolution
 * - Error handling
 *
 * These tests use mocked database queries to isolate business logic.
 */

import { SyncService } from '../../services/sync.service.js';
import { NotFoundError, DatabaseError } from '../../utils/errors.js';
import { query } from '../../utils/database.js';

// Mock the database module
jest.mock('../../utils/database.js');
const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService();
    jest.clearAllMocks();
  });

  describe('uploadEvents', () => {
    const mockUserId = 'user-123';
    const mockDeviceId = 'device-123';

    it('should upload new events successfully', async () => {
      const events = [
        {
          id: 'event-1',
          event_type: 'app_usage' as const,
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      // Mock successful queries
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // Check existing
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert events
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.uploadEvents(mockUserId, mockDeviceId, {
        events,
        last_sync_at: 0,
      });

      expect(result.processedCount).toBe(1);
      expect(result.conflicts).toHaveLength(0);
      expect(result.syncedAt).toBeDefined();
    });

    it('should detect conflicts when server has newer version', async () => {
      const eventId = 'event-conflict';
      const serverTimestamp = Date.now();
      const clientTimestamp = serverTimestamp - 3600000; // 1 hour older

      const events = [
        {
          id: eventId,
          event_type: 'app_usage' as const,
          timestamp: clientTimestamp,
          duration: 300,
          encrypted_data: 'client_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      // Mock existing event with newer timestamp
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: eventId,
          timestamp: new Date(serverTimestamp),
          encrypted_data: 'server_data',
        }],
        rowCount: 1,
      } as never);

      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.uploadEvents(mockUserId, mockDeviceId, {
        events,
        last_sync_at: 0,
      });

      expect(result.processedCount).toBe(0); // Client is older, no update
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].event_id).toBe(eventId);
      expect(result.conflicts[0].server_version.encrypted_data).toBe('server_data');
    });

    it('should update when client has newer version', async () => {
      const eventId = 'event-update';
      const clientTimestamp = Date.now();
      const serverTimestamp = clientTimestamp - 3600000; // 1 hour older

      const events = [
        {
          id: eventId,
          event_type: 'app_usage' as const,
          timestamp: clientTimestamp,
          duration: 600,
          encrypted_data: 'client_data_newer',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      // Mock existing event with older timestamp
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: eventId,
          timestamp: new Date(serverTimestamp),
          encrypted_data: 'server_data_older',
        }],
        rowCount: 1,
      } as never);

      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert events
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.uploadEvents(mockUserId, mockDeviceId, {
        events,
        last_sync_at: 0,
      });

      expect(result.processedCount).toBe(1); // Client is newer, should update
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle empty events array', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.uploadEvents(mockUserId, mockDeviceId, {
        events: [],
        last_sync_at: 0,
      });

      expect(result.processedCount).toBe(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle database errors', async () => {
      const events = [
        {
          id: 'event-1',
          event_type: 'app_usage' as const,
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      mockedQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        syncService.uploadEvents(mockUserId, mockDeviceId, {
          events,
          last_sync_at: 0,
        })
      ).rejects.toThrow(DatabaseError);
    });

    it('should handle transaction rollback on error', async () => {
      const events = [
        {
          id: 'event-1',
          event_type: 'app_usage' as const,
          timestamp: Date.now(),
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag_here_16bytes_base',
        },
      ];

      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // Check existing
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert events
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // BEGIN
      mockedQuery.mockRejectedValueOnce(new Error('Transaction failed')); // Fail during transaction

      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // ROLLBACK

      await expect(
        syncService.uploadEvents(mockUserId, mockDeviceId, {
          events,
          last_sync_at: 0,
        })
      ).rejects.toThrow(DatabaseError);
    });
  });

  describe('downloadEvents', () => {
    const mockUserId = 'user-123';
    const mockDeviceId = 'device-123';

    it('should download events with default options', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          event_type: 'app_usage',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          duration: 300,
          encrypted_data: 'encrypted_data',
          nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
          tag: 'auth_tag',
          app_name: 'VSCode',
          category: 'work',
        },
      ];

      mockedQuery.mockResolvedValueOnce({
        rows: mockEvents,
        rowCount: 1,
      } as never);
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.downloadEvents(mockUserId, mockDeviceId, {
        since: undefined,
        limit: 100,
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe('event-1');
      expect(result.hasMore).toBe(false);
      expect(result.latestTimestamp).toBeDefined();
    });

    it('should filter events by since timestamp', async () => {
      const since = Date.now() - 3600000; // 1 hour ago

      mockedQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.downloadEvents(mockUserId, mockDeviceId, {
        since,
        limit: 100,
      });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('timestamp > $'),
        expect.arrayContaining([mockUserId, since, expect.any(Number)])
      );
      expect(result.events).toHaveLength(0);
    });

    it('should handle hasMore correctly', async () => {
      // Return 101 events when limit is 100
      const mockEvents = Array.from({ length: 101 }, (_, i) => ({
        id: `event-${i}`,
        event_type: 'app_usage',
        timestamp: new Date(),
        duration: 300,
        encrypted_data: 'encrypted_data',
        nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
        tag: 'auth_tag',
      }));

      mockedQuery.mockResolvedValueOnce({
        rows: mockEvents,
        rowCount: 101,
      } as never);
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.downloadEvents(mockUserId, mockDeviceId, {
        since: undefined,
        limit: 100,
      });

      expect(result.events).toHaveLength(100); // Limited to 100
      expect(result.hasMore).toBe(true);
    });

    it('should handle empty result set', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Insert sync record
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update user
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // Update device
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

      const result = await syncService.downloadEvents(mockUserId, mockDeviceId, {
        since: undefined,
        limit: 100,
      });

      expect(result.events).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.latestTimestamp).toBe(0);
    });

    it('should handle database errors', async () => {
      mockedQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        syncService.downloadEvents(mockUserId, mockDeviceId, {
          since: undefined,
          limit: 100,
        })
      ).rejects.toThrow(DatabaseError);
    });
  });

  describe('getSyncStatus', () => {
    const mockUserId = 'user-123';
    const mockDeviceId = 'device-123';

    it('should return sync status', async () => {
      const lastSyncAt = new Date('2024-01-01T10:00:00Z');

      mockedQuery.mockResolvedValueOnce({
        rows: [{ last_sync_at: lastSyncAt }],
        rowCount: 1,
      } as never);

      mockedQuery.mockResolvedValueOnce({
        rows: [{ count: '42' }],
        rowCount: 1,
      } as never);

      const result = await syncService.getSyncStatus(mockUserId, mockDeviceId);

      expect(result.deviceId).toBe(mockDeviceId);
      expect(result.lastSyncAt).toBe(lastSyncAt.getTime());
      expect(result.syncedCount).toBe(42);
      expect(result.pendingCount).toBe(0);
    });

    it('should handle user with no sync history', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ last_sync_at: null }],
        rowCount: 1,
      } as never);

      mockedQuery.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as never);

      const result = await syncService.getSyncStatus(mockUserId, mockDeviceId);

      expect(result.lastSyncAt).toBeNull();
      expect(result.syncedCount).toBe(0);
      expect(result.pendingCount).toBe(0);
    });

    it('should throw NotFoundError for non-existent user', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      await expect(
        syncService.getSyncStatus(mockUserId, mockDeviceId)
      ).rejects.toThrow(NotFoundError);
    });

    it('should handle database errors', async () => {
      mockedQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        syncService.getSyncStatus(mockUserId, mockDeviceId)
      ).rejects.toThrow(DatabaseError);
    });
  });
});
