import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fields: Record<string, string> = {};

        error.errors.forEach((err) => {
          const path = err.path.join('.');
          fields[path] = err.message;
        });

        logger.debug({
          fields,
          body: req.body,
        }, 'Validation failed');

        res.status(400).json({
          error: 'validation_error',
          message: 'Request validation failed',
          fields,
        });
      } else {
        logger.error({
          err: error,
        }, 'Unexpected validation error');

        res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  };
}

export function validateQuery<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fields: Record<string, string> = {};

        error.errors.forEach((err) => {
          const path = err.path.join('.');
          fields[path] = err.message;
        });

        logger.debug({
          fields,
          query: req.query,
        }, 'Query validation failed');

        res.status(400).json({
          error: 'validation_error',
          message: 'Query validation failed',
          fields,
        });
      } else {
        logger.error({
          err: error,
        }, 'Unexpected validation error');

        res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred',
        });
      }
    }
  };
}
