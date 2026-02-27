import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { ZodError } from 'zod';
import { UnauthorizedError, NotFoundError, DatabaseError, ValidationError } from '../utils/errors.js';

/**
 * Centralized error handling middleware
 * Catches all errors and formats them consistently
 */
export function errorHandler(
  err: Error | unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  const errorContext = {
    error: err,
    path: req.path,
    method: req.method,
    ip: req.ip,
    requestId: (req as any).requestId || 'unknown',
  };

  // Handle CORS errors
  if (err instanceof Error && err.message.startsWith('CORS:')) {
    logger.warn(errorContext, 'CORS error');
    res.status(403).json({
      error: 'cors_error',
      message: err.message,
    });
    return;
  }

  // Handle known error types
  if (err instanceof UnauthorizedError) {
    logger.warn(errorContext, 'Unauthorized access attempt');
    res.status(401).json({
      error: 'unauthorized',
      message: err.message,
    });
    return;
  }

  if (err instanceof NotFoundError) {
    logger.warn(errorContext, 'Resource not found');
    res.status(404).json({
      error: 'not_found',
      message: err.message,
    });
    return;
  }

  if (err instanceof ValidationError || err instanceof ZodError) {
    logger.warn(errorContext, 'Validation failed');
    res.status(400).json({
      error: 'validation_error',
      message: 'Invalid input data',
      details: err instanceof ZodError ? err.errors : err.message,
    });
    return;
  }

  if (err instanceof DatabaseError) {
    logger.error(errorContext, 'Database error occurred');
    res.status(500).json({
      error: 'database_error',
      message: 'A database error occurred. Please try again later.',
    });
    return;
  }

  // Unknown/unexpected errors
  logger.error(errorContext, 'Unexpected error occurred');

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).json({
    error: 'internal_error',
    message: isDevelopment ? (err as Error).message : 'An unexpected error occurred',
    ...(isDevelopment && { stack: (err as Error).stack }),
  });
}

/**
 * Wrapper for async route handlers to catch errors
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 Not Found handler
 * Must be registered after all routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'not_found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}
