import type { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limit storage (use Redis in production for distributed systems)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Get identifier (prefer user ID, fall back to IP)
      const userId = (req as any).user?.id;
      const identifier = userId || req.ip || 'unknown';

      // Create key specific to endpoint
      const key = `${identifier}:${req.route?.path || req.path}`;

      const now = Date.now();
      const entry = rateLimitStore.get(key);

      if (!entry || entry.resetAt < now) {
        // Create new entry or reset expired one
        rateLimitStore.set(key, {
          count: 1,
          resetAt: now + windowMs,
        });

        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', (maxRequests - 1).toString());
        res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

        next();
        return;
      }

      if (entry.count >= maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

        logger.warn({
          identifier,
          path: req.path,
          method: req.method,
          count: entry.count,
          limit: maxRequests,
        }, 'Rate limit exceeded');

        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(entry.resetAt).toISOString());
        res.setHeader('Retry-After', retryAfter.toString());

        throw new RateLimitError(retryAfter);
      }

      // Increment counter
      entry.count++;

      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', (maxRequests - entry.count).toString());
      res.setHeader('X-RateLimit-Reset', new Date(entry.resetAt).toISOString());

      next();
    } catch (error) {
      if (error instanceof RateLimitError) {
        res.status(429).json({
          error: 'rate_limit_exceeded',
          message: `Too many requests. Try again in ${error.retryAfter} seconds.`,
          details: {
            retry_after: error.retryAfter,
            limit: maxRequests,
            window: Math.ceil(windowMs / 1000),
          },
        });
      } else {
        logger.error({
          err: error,
          path: req.path,
          method: req.method,
        }, 'Unexpected rate limit error');

        res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  };
}

// Predefined rate limiters
export const authRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 5,  // 5 requests per minute
});

export const syncRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 100, // 100 requests per minute
});

export const defaultRateLimiter = createRateLimiter({
  windowMs: 3600000, // 1 hour
  maxRequests: 1000, // 1000 requests per hour
});

export const analysisRateLimiter = createRateLimiter({
  windowMs: 3600000, // 1 hour
  maxRequests: 20, // 20 requests per hour (AI is expensive)
});
