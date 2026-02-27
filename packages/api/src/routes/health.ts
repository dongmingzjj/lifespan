import type { Response } from 'express';
import { Router } from 'express';
import { healthCheck } from '../utils/database.js';

const router = Router();

/**
 * GET /api/v1/health
 * Health check endpoint
 */
router.get('/', async (_req: unknown, res: Response) => {
  const dbHealthy = await healthCheck().catch(() => false);

  const status = {
    status: dbHealthy ? 'healthy' : 'degraded',
    version: process.env.npm_package_version || '1.0.0',
    database: dbHealthy ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  };

  const statusCode = dbHealthy ? 200 : 503;

  res.status(statusCode).json(status);
});

export default router;
