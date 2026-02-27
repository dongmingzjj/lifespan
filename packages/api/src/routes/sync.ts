import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { UploadEventsSchema } from '../validators/sync.schema.js';
import { validateBody, validateQuery } from '../middleware/validation.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { syncRateLimiter } from '../middleware/rateLimit.js';
import { syncService } from '../services/sync.service.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, DatabaseError } from '../utils/errors.js';

const router = Router();

// Helper function to generate request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * POST /api/v1/sync/events
 * Upload events from client to server
 */
router.post(
  '/events',
  authMiddleware,
  syncRateLimiter,
  validateBody(UploadEventsSchema),
  async (req, res: Response): Promise<Response | void> => {
    const requestId = generateRequestId();
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.id;
    const deviceId = authReq.user.deviceId;

    try {
      logger.info({
        requestId,
        userId,
        deviceId,
        eventCount: req.body.events.length,
      }, 'Event sync upload request');

      const result = await syncService.uploadEvents(userId, deviceId, req.body);

      // If there are conflicts, return 409 with conflict info
      if (result.conflicts.length > 0) {
        logger.info({
          requestId,
          userId,
          deviceId,
          conflictCount: result.conflicts.length,
        }, 'Sync conflicts detected');

        return res.status(409).json({
          error: 'sync_conflict',
          message: 'Some events have conflicts on the server',
          resolution: 'last_write_wins',
          processed_count: result.processedCount,
          conflicts: result.conflicts,
          synced_at: result.syncedAt,
        });
      }

      logger.info({
        requestId,
        userId,
        deviceId,
        processedCount: result.processedCount,
      }, 'Event sync upload completed');

      res.status(200).json({
        synced_at: result.syncedAt,
        processed_count: result.processedCount,
        conflicts: [],
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn({
          requestId,
          userId,
          deviceId,
          error: error.message,
        }, 'Sync upload failed: not found');

        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      } else if (error instanceof DatabaseError) {
        logger.error({
          requestId,
          userId,
          deviceId,
          err: error,
        }, 'Sync upload failed: database error');

        return res.status(500).json({
          error: 'database_error',
          message: 'Failed to upload events',
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          userId,
          deviceId,
          err: error,
        }, 'Sync upload failed: unexpected error');

        return res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
);

/**
 * GET /api/v1/sync/events
 * Download events from server to client (incremental sync)
 */
router.get(
  '/events',
  authMiddleware,
  syncRateLimiter,
  validateQuery(
    z.object({
      since: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(100),
    })
  ),
  async (req, res: Response): Promise<Response | void> => {
    const requestId = generateRequestId();
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.id;
    const deviceId = authReq.user.deviceId;

    try {
      logger.info({
        requestId,
        userId,
        deviceId,
        since: req.query.since,
        limit: req.query.limit,
      }, 'Event sync download request');

      const queryOptions = {
        since: typeof req.query.since === 'number' ? req.query.since : undefined,
        limit: typeof req.query.limit === 'number' ? req.query.limit : 100,
      };
      const result = await syncService.downloadEvents(userId, deviceId, queryOptions);

      logger.info({
        requestId,
        userId,
        deviceId,
        eventCount: result.events.length,
        hasMore: result.hasMore,
      }, 'Event sync download completed');

      res.status(200).json({
        events: result.events,
        has_more: result.hasMore,
        latest_timestamp: result.latestTimestamp,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn({
          requestId,
          userId,
          deviceId,
          error: error.message,
        }, 'Sync download failed: not found');

        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      } else if (error instanceof DatabaseError) {
        logger.error({
          requestId,
          userId,
          deviceId,
          err: error,
        }, 'Sync download failed: database error');

        return res.status(500).json({
          error: 'database_error',
          message: 'Failed to download events',
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          userId,
          deviceId,
          err: error,
        }, 'Sync download failed: unexpected error');

        return res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
);

/**
 * GET /api/v1/sync/status
 * Get sync status for the current user/device
 */
router.get(
  '/status',
  authMiddleware,
  syncRateLimiter,
  async (req, res: Response): Promise<Response | void> => {
    const requestId = generateRequestId();
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.id;
    const deviceId = authReq.user.deviceId;

    try {
      logger.info({
        requestId,
        userId,
        deviceId,
      }, 'Sync status request');

      const status = await syncService.getSyncStatus(userId, deviceId);

      logger.debug({
        requestId,
        userId,
        deviceId,
        lastSyncAt: status.lastSyncAt,
        syncedCount: status.syncedCount,
      }, 'Sync status retrieved');

      res.status(200).json({
        device_id: status.deviceId,
        last_sync_at: status.lastSyncAt,
        pending_count: status.pendingCount,
        synced_count: status.syncedCount,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn({
          requestId,
          userId,
          deviceId,
          error: error.message,
        }, 'Sync status failed: not found');

        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      } else if (error instanceof DatabaseError) {
        logger.error({
          requestId,
          userId,
          deviceId,
          err: error,
        }, 'Sync status failed: database error');

        return res.status(500).json({
          error: 'database_error',
          message: 'Failed to get sync status',
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          userId,
          deviceId,
          err: error,
        }, 'Sync status failed: unexpected error');

        return res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
);

export default router;
