/**
 * Analysis API Routes
 * Endpoints for behavior analysis, user portrait, and AI recommendations
 * @module routes/analysis
 */

import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import {
  GetInsightsSchema,
  GeneratePortraitSchema,
  GetRecommendationsSchema,
} from '../validators/analysis.schema.js';
import { validateQuery, validateBody } from '../middleware/validation.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { analysisRateLimiter } from '../middleware/rateLimit.js';
import { analysisService } from '../services/analysis.service.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, DatabaseError } from '../utils/errors.js';

const router = Router();

/**
 * Helper function to generate request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * GET /api/v1/analysis/insights
 * Get behavior insights for the current user
 *
 * Returns cached insights if available and fresh, otherwise generates new ones.
 */
router.get(
  '/insights',
  authMiddleware,
  analysisRateLimiter,
  validateQuery(
    z.object({
      force_refresh: z.coerce.boolean().optional().default(false),
      days: z.coerce.number().int().min(1).max(90).optional().default(30),
      max_cache_age: z.coerce.number().int().min(0).optional(),
    })
  ),
  async (req: AuthenticatedRequest, res: Response): Promise<Response | void> => {
    const requestId = generateRequestId();
    const userId = req.user.id;
    const query = req.query as any;

    try {
      logger.info({
        requestId,
        userId,
        forceRefresh: query.force_refresh,
        days: query.days,
      }, 'Behavior insights request');

      const result = await analysisService.getInsights(userId, {
        forceRefresh: query.force_refresh,
        days: query.days,
        maxCacheAge: query.max_cache_age,
      });

      logger.info({
        requestId,
        userId,
        workStyle: result.insights.work_style,
        productivityScore: result.portrait?.productivity_score,
        recommendationCount: result.recommendations.length,
      }, 'Behavior insights retrieved');

      return res.status(200).json({
        user_id: result.user_id,
        insights: result.insights,
        portrait: result.portrait,
        recommendations: result.recommendations,
        last_updated: result.last_updated,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn({
          requestId,
          userId,
          error: error.message,
        }, 'Insights request failed: not found');

        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      } else if (error instanceof DatabaseError) {
        logger.error({
          requestId,
          userId,
          err: error,
        }, 'Insights request failed: database error');

        return res.status(500).json({
          error: 'database_error',
          message: 'Failed to retrieve behavior insights',
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          userId,
          err: error,
        }, 'Insights request failed: unexpected error');

        return res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
);

/**
 * POST /api/v1/analysis/portrait
 * Generate a new user portrait
 *
 * Analyzes user behavior to create a comprehensive behavioral profile.
 */
router.post(
  '/portrait',
  authMiddleware,
  analysisRateLimiter,
  validateBody(
    z.object({
      days: z.coerce.number().int().min(1).max(90).optional().default(30),
    })
  ),
  async (req: AuthenticatedRequest, res: Response): Promise<Response | void> => {
    const requestId = generateRequestId();
    const userId = req.user.id;
    const body = req.body as any;

    try {
      logger.info({
        requestId,
        userId,
        days: body.days,
      }, 'User portrait generation request');

      const portrait = await analysisService.generatePortrait(userId, body.days);

      logger.info({
        requestId,
        userId,
        workStyle: portrait.work_style,
        productivityScore: portrait.productivity_score,
      }, 'User portrait generated');

      return res.status(200).json(portrait);
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn({
          requestId,
          userId,
          error: error.message,
        }, 'Portrait generation failed: not found');

        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      } else if (error instanceof DatabaseError) {
        logger.error({
          requestId,
          userId,
          err: error,
        }, 'Portrait generation failed: database error');

        return res.status(500).json({
          error: 'database_error',
          message: 'Failed to generate user portrait',
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          userId,
          err: error,
        }, 'Portrait generation failed: unexpected error');

        return res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
);

/**
 * GET /api/v1/analysis/recommendations
 * Get AI-powered productivity recommendations
 *
 * Returns cached recommendations if available, otherwise generates new ones.
 */
router.get(
  '/recommendations',
  authMiddleware,
  analysisRateLimiter,
  validateQuery(
    z.object({
      force_refresh: z.coerce.boolean().optional().default(false),
    })
  ),
  async (req: AuthenticatedRequest, res: Response): Promise<Response | void> => {
    const requestId = generateRequestId();
    const userId = req.user.id;
    const query = req.query as any;

    try {
      logger.info({
        requestId,
        userId,
        forceRefresh: query.force_refresh,
      }, 'Recommendations request');

      const recommendations = await analysisService.getRecommendations(
        userId,
        query.force_refresh ? undefined : undefined
      );

      logger.info({
        requestId,
        userId,
        count: recommendations.length,
      }, 'Recommendations retrieved');

      return res.status(200).json({
        recommendations,
        count: recommendations.length,
        last_updated: recommendations.length > 0
          ? recommendations[0].created_at
          : null,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn({
          requestId,
          userId,
          error: error.message,
        }, 'Recommendations request failed: not found');

        return res.status(404).json({
          error: 'not_found',
          message: error.message,
        });
      } else if (error instanceof DatabaseError) {
        logger.error({
          requestId,
          userId,
          err: error,
        }, 'Recommendations request failed: database error');

        return res.status(500).json({
          error: 'database_error',
          message: 'Failed to retrieve recommendations',
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          userId,
          err: error,
        }, 'Recommendations request failed: unexpected error');

        return res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
);

export default router;
