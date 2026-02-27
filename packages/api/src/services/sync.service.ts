import { v4 as uuidv4 } from 'uuid';
import { query } from '../utils/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { verifyDeviceOwnership, invalidateDeviceCache } from '../cache/device.cache.js';
import type { EncryptedEvent, UploadEventsInput, DownloadEventsInput } from '../validators/sync.schema.js';

export interface UploadResult {
  processedCount: number;
  conflicts: ConflictInfo[];
  syncedAt: number;
}

export interface ConflictInfo {
  event_id: string;
  server_version: {
    id: string;
    timestamp: Date;
    encrypted_data: string;
  };
}

export interface DownloadResult {
  events: EncryptedEvent[];
  hasMore: boolean;
  latestTimestamp: number;
}

export interface SyncStatus {
  deviceId: string;
  lastSyncAt: number | null;
  pendingCount: number;
  syncedCount: number;
}

export class SyncService {
  /**
   * Upload events from client to server
   * Implements batch insert with conflict detection (last-write-wins)
   */
  async uploadEvents(
    userId: string,
    deviceId: string,
    input: UploadEventsInput
  ): Promise<UploadResult> {
    const startTime = Date.now();

    try {
      logger.info({
        userId,
        deviceId,
        eventCount: input.events.length,
        lastSyncAt: input.last_sync_at,
      }, 'Processing event upload');

      // Verify device belongs to user (with caching)
      await verifyDeviceOwnership(deviceId, userId);

      const conflicts: ConflictInfo[] = [];
      const eventsToInsert: EncryptedEvent[] = [];
      const eventIds = input.events.map(e => e.id);

      // Check for existing events (conflict detection)
      if (eventIds.length > 0) {
        const existingResult = await query(
          `SELECT id, timestamp, encrypted_data
           FROM events
           WHERE id = ANY($1) AND user_id = $2`,
          [eventIds, userId]
        );

        const existingEvents = new Map(
          existingResult.rows.map(row => [row.id, row])
        );

        // Separate into conflicts and new events
        for (const event of input.events) {
          const existing = existingEvents.get(event.id);

          if (existing) {
            // Conflict: compare timestamps (last-write-wins)
            const serverTimestamp = new Date(existing.timestamp).getTime();
            const clientTimestamp = event.timestamp;

            // If client is newer, it will update (handled below)
            // If server is newer, record as conflict
            if (serverTimestamp > clientTimestamp) {
              conflicts.push({
                event_id: event.id,
                server_version: {
                  id: existing.id,
                  timestamp: existing.timestamp,
                  encrypted_data: existing.encrypted_data,
                },
              });
            } else if (serverTimestamp < clientTimestamp) {
              // Client is newer, will update
              eventsToInsert.push(event);
            }
            // If timestamps are equal, skip (no change needed)
          } else {
            // No existing event, insert
            eventsToInsert.push(event);
          }
        }
      }

      // Batch insert/update events with transaction
      let processedCount = 0;

      if (eventsToInsert.length > 0) {
        // Use INSERT ... ON CONFLICT for upsert
        const insertValues = eventsToInsert.map(event => [
          event.id,
          userId,
          deviceId,
          event.event_type,
          new Date(event.timestamp),
          event.duration,
          event.encrypted_data,
          event.nonce,
          event.tag || null,
          event.app_name || null,
          event.category || null,
          event.domain || null,
        ]);

        // Build the query dynamically
        const rows = insertValues.map((_, i) =>
          `($${i * 12 + 1}, $${i * 12 + 2}, $${i * 12 + 3}, $${i * 12 + 4}, $${i * 12 + 5}, $${i * 12 + 6}, $${i * 12 + 7}, $${i * 12 + 8}, $${i * 12 + 9}, $${i * 12 + 10}, $${i * 12 + 11}, $${i * 12 + 12})`
        ).join(', ');

        const flatValues = insertValues.flat();

        await query(
          `INSERT INTO events (
            id, user_id, device_id, event_type, timestamp, duration,
            encrypted_data, iv, auth_tag, app_name, category, domain
          ) VALUES ${rows}
          ON CONFLICT (id) DO UPDATE SET
            timestamp = EXCLUDED.timestamp,
            duration = EXCLUDED.duration,
            encrypted_data = EXCLUDED.encrypted_data,
            iv = EXCLUDED.iv,
            auth_tag = EXCLUDED.auth_tag,
            app_name = EXCLUDED.app_name,
            category = EXCLUDED.category,
            domain = EXCLUDED.domain,
            synced_at = CURRENT_TIMESTAMP`,
          flatValues
        );

        processedCount = eventsToInsert.length;
      }

      // Wrap sync record and updates in a transaction
      await query('BEGIN');

      try {
        // Create sync record
        await query(
          `INSERT INTO sync_records (id, user_id, device_id, sync_type, events_count, status, start_time, end_time, created_at)
             VALUES ($1, $2, $3, 'upload', $4, 'success', $5, $6, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            userId,
            deviceId,
            input.events.length,
            new Date(startTime),
            new Date(),
          ]
        );

        // Update user's last sync time
        await query(
          'UPDATE users SET last_sync_at = CURRENT_TIMESTAMP WHERE id = $1',
          [userId]
        );

        // Update device last seen
        await query(
          'UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1',
          [deviceId]
        );

        await query('COMMIT');

        // Invalidate device cache after successful update
        invalidateDeviceCache(deviceId);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }

      const duration = Date.now() - startTime;

      logger.info({
        userId,
        deviceId,
        processedCount,
        conflictCount: conflicts.length,
        duration,
      }, 'Event upload completed');

      return {
        processedCount,
        conflicts,
        syncedAt: Date.now(),
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        deviceId,
      }, 'Event upload failed');

      throw new DatabaseError('Failed to upload events', error as Error);
    }
  }

  /**
   * Download events from server to client (incremental sync)
   */
  async downloadEvents(
    userId: string,
    deviceId: string,
    options: DownloadEventsInput
  ): Promise<DownloadResult> {
    const startTime = Date.now();

    try {
      logger.info({
        userId,
        deviceId,
        since: options.since,
        limit: options.limit,
      }, 'Processing event download');

      // Verify device belongs to user (with caching)
      await verifyDeviceOwnership(deviceId, userId);

      // Build query
      let queryText = `
        SELECT
          id,
          event_type,
          timestamp,
          duration,
          encrypted_data,
          iv as nonce,
          auth_tag as tag,
          app_name,
          category,
          domain
        FROM events
        WHERE user_id = $1
      `;

      const params: (string | number)[] = [userId];
      let paramIndex = 2;

      // Add time filter if provided
      if (options.since) {
        queryText += ` AND timestamp > $${paramIndex}`;
        params.push(options.since);
        paramIndex++;
      }

      // Order by timestamp and limit
      queryText += ` ORDER BY timestamp ASC LIMIT $${paramIndex}`;
      params.push(options.limit + 1); // Fetch one extra to check if there are more

      const result = await query(queryText, params);

      const hasMore = result.rows.length > options.limit;
      const events = result.rows.slice(0, options.limit).map(row => ({
        id: row.id,
        event_type: row.event_type,
        timestamp: new Date(row.timestamp).getTime(),
        duration: row.duration,
        encrypted_data: row.encrypted_data,
        nonce: row.nonce,
        tag: row.tag || '',
        app_name: row.app_name || undefined,
        category: row.category || undefined,
        domain: row.domain || undefined,
      }));

      const latestTimestamp = events.length > 0
        ? events[events.length - 1].timestamp
        : options.since || 0;

      // Wrap sync record and updates in a transaction
      await query('BEGIN');

      try {
        // Create sync record
        await query(
          `INSERT INTO sync_records (id, user_id, device_id, sync_type, events_count, status, start_time, end_time, created_at)
             VALUES ($1, $2, $3, 'download', $4, 'success', $5, $6, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            userId,
            deviceId,
            events.length,
            new Date(startTime),
            new Date(),
          ]
        );

        // Update user's last sync time
        await query(
          'UPDATE users SET last_sync_at = CURRENT_TIMESTAMP WHERE id = $1',
          [userId]
        );

        // Update device last seen
        await query(
          'UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1',
          [deviceId]
        );

        await query('COMMIT');

        // Invalidate device cache after successful update
        invalidateDeviceCache(deviceId);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }

      const duration = Date.now() - startTime;

      logger.info({
        userId,
        deviceId,
        eventCount: events.length,
        hasMore,
        duration,
      }, 'Event download completed');

      return {
        events,
        hasMore,
        latestTimestamp,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        deviceId,
      }, 'Event download failed');

      throw new DatabaseError('Failed to download events', error as Error);
    }
  }

  /**
   * Get sync status for a user/device
   */
  async getSyncStatus(userId: string, deviceId: string): Promise<SyncStatus> {
    try {
      // Verify device belongs to user (with caching)
      await verifyDeviceOwnership(deviceId, userId);

      // Get user's last sync time
      const userResult = await query(
        'SELECT last_sync_at FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new NotFoundError('User not found');
      }

      const lastSyncAt = userResult.rows[0].last_sync_at
        ? new Date(userResult.rows[0].last_sync_at).getTime()
        : null;

      // Count total synced events
      const countResult = await query(
        'SELECT COUNT(*) as count FROM events WHERE user_id = $1',
        [userId]
      );

      const syncedCount = parseInt(countResult.rows[0].count, 10);

      // For pending count, we'd need to track unsynced local events
      // Since this is server-side, pending_count is always 0
      // (the client tracks its own pending uploads)

      logger.debug({
        userId,
        deviceId,
        lastSyncAt,
        syncedCount,
      }, 'Sync status retrieved');

      return {
        deviceId,
        lastSyncAt,
        pendingCount: 0,
        syncedCount,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        deviceId,
      }, 'Failed to get sync status');

      throw new DatabaseError('Failed to get sync status', error as Error);
    }
  }
}

// Export singleton instance
export const syncService = new SyncService();
