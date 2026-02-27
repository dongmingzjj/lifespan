import type { Request, Response } from 'express';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  type RegisterInput,
  type LoginInput,
} from '../validators/sync.schema.js';
import { validateBody } from '../middleware/validation.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { query } from '../utils/database.js';
import { UnauthorizedError, ConflictError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Helper function to generate request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// POST /api/v1/auth/register
router.post(
  '/register',
  authRateLimiter,
  validateBody(RegisterSchema),
  async (req: Request, res: Response) => {
    const requestId = generateRequestId();
    const input = req.body as RegisterInput;

    try {
      logger.info({
        requestId,
        email: input.email,
        username: input.username,
      }, 'User registration attempt');

      // Check if user already exists
      const existingUser = await query(
        'SELECT id, email, username FROM users WHERE email = $1 OR username = $2',
        [input.email, input.username]
      );

      if (existingUser.rows.length > 0) {
        const existing = existingUser.rows[0];
        if (existing.email === input.email) {
          throw new ConflictError('Email already registered');
        }
        if (existing.username === input.username) {
          throw new ConflictError('Username already taken');
        }
      }

      // Hash password with bcrypt (cost factor 12)
      const passwordHash = await bcrypt.hash(input.password, 12);

      // Create user
      const userId = uuidv4();
      const result = await query(
        `INSERT INTO users (id, username, email, password_hash, is_verified, created_at)
         VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
         RETURNING id, username, email, created_at`,
        [userId, input.username, input.email, passwordHash]
      );

      const user = result.rows[0];

      // Register device if provided
      let deviceId: string | null = null;
      if (input.device_name) {
        const deviceResult = await query(
          `INSERT INTO devices (id, user_id, device_name, device_type, is_active, created_at)
           VALUES ($1, $2, $3, 'windows', true, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, device_type)
           DO UPDATE SET is_active = true, last_seen_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [uuidv4(), userId, input.device_name]
        );
        deviceId = deviceResult.rows[0].id;
      }

      // Generate tokens
      const accessToken = generateAccessToken({
        sub: user.id,
        device_id: deviceId || uuidv4(), // Fallback for token generation
      });

      const refreshToken = generateRefreshToken({
        sub: user.id,
        device_id: deviceId || uuidv4(),
      });

      logger.info({
        requestId,
        userId: user.id,
      }, 'User registered successfully');

      res.status(201).json({
        user_id: user.id,
        access_token: accessToken,
        refresh_token: refreshToken,
        device_id: deviceId,
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        logger.warn({
          requestId,
          email: input.email,
          error: error.message,
        }, 'Registration failed: conflict');

        res.status(409).json({
          error: 'conflict',
          message: error.message,
        });
      } else if (error instanceof Error) {
        // Enhanced error logging for debugging
        logger.error({
          requestId,
          err: error,
          errorMessage: error.message,
          errorStack: error.stack,
          errorName: error.constructor.name,
          email: input.email,
        }, 'Registration failed with error');

        // In development, send error details for debugging
        if (process.env.NODE_ENV === 'development') {
          res.status(500).json({
            error: 'internal_error',
            message: 'Registration failed',
            details: error.message,
            type: error.constructor.name,
          });
        } else {
          res.status(500).json({
            error: 'internal_error',
            message: 'Registration failed',
          });
        }
      }
    }
  }
);

// POST /api/v1/auth/login
router.post(
  '/login',
  authRateLimiter,
  validateBody(LoginSchema),
  async (req: Request, res: Response) => {
    const requestId = generateRequestId();
    const input = req.body as LoginInput;

    try {
      logger.info({
        requestId,
        email: input.email,
      }, 'User login attempt');

      // Find user by email
      const result = await query(
        'SELECT id, username, email, password_hash, is_active FROM users WHERE email = $1',
        [input.email]
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const user = result.rows[0];

      if (!user.is_active) {
        throw new UnauthorizedError('Account is inactive');
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(input.password, user.password_hash);

      if (!passwordMatch) {
        throw new UnauthorizedError('Invalid email or password');
      }

      // Register or update device
      let deviceId: string;
      const deviceResult = await query(
        `INSERT INTO devices (id, user_id, device_name, device_type, is_active, last_seen_at, created_at)
         VALUES ($1, $2, $3, 'windows', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, device_type)
         DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, is_active = true
         RETURNING id`,
        [uuidv4(), user.id, input.device_name || 'Unknown Device']
      );

      deviceId = deviceResult.rows[0].id;

      // Generate tokens
      const accessToken = generateAccessToken({
        sub: user.id,
        device_id: deviceId,
      });

      const refreshToken = generateRefreshToken({
        sub: user.id,
        device_id: deviceId,
      });

      logger.info({
        requestId,
        userId: user.id,
        deviceId,
      }, 'User logged in successfully');

      res.status(200).json({
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.warn({
          requestId,
          email: input.email,
        }, 'Login failed: invalid credentials');

        res.status(401).json({
          error: 'invalid_credentials',
          message: error.message,
        });
      } else if (error instanceof Error) {
        // Enhanced error logging for debugging
        logger.error({
          requestId,
          err: error,
          errorMessage: error.message,
          errorStack: error.stack,
          errorName: error.constructor.name,
          email: input.email,
        }, 'Login failed with error');

        // In development, send error details for debugging
        if (process.env.NODE_ENV === 'development') {
          res.status(500).json({
            error: 'internal_error',
            message: 'Login failed',
            details: error.message,
            type: error.constructor.name,
          });
        } else {
          res.status(500).json({
            error: 'internal_error',
            message: 'Login failed',
          });
        }
      }
    }
  }
);

// POST /api/v1/auth/refresh
router.post(
  '/refresh',
  authRateLimiter,
  validateBody(RefreshTokenSchema),
  async (req: Request, res: Response) => {
    const requestId = generateRequestId();
    const { refresh_token } = req.body as { refresh_token: string };

    try {
      // Verify refresh token
      const payload = verifyToken(refresh_token);

      logger.info({
        requestId,
        userId: payload.sub,
      }, 'Token refresh attempt');

      // Check if user still exists and is active
      const userResult = await query(
        'SELECT id, is_active FROM users WHERE id = $1',
        [payload.sub]
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        throw new UnauthorizedError('Invalid token');
      }

      // Generate new tokens
      const accessToken = generateAccessToken({
        sub: payload.sub,
        device_id: payload.device_id,
      });

      const newRefreshToken = generateRefreshToken({
        sub: payload.sub,
        device_id: payload.device_id,
      });

      logger.info({
        requestId,
        userId: payload.sub,
      }, 'Token refreshed successfully');

      res.status(200).json({
        access_token: accessToken,
        refresh_token: newRefreshToken,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.warn({
          requestId,
        }, 'Token refresh failed: invalid token');

        res.status(401).json({
          error: 'invalid_token',
          message: error.message,
        });
      } else if (error instanceof Error) {
        logger.error({
          requestId,
          err: error,
        }, 'Token refresh failed');

        res.status(500).json({
          error: 'internal_error',
          message: 'Token refresh failed',
        });
      }
    }
  }
);

// POST /api/v1/auth/logout
router.post(
  '/logout',
  async (req: Request, res: Response) => {
    const requestId = generateRequestId();
    const authReq = req as AuthenticatedRequest;

    // For JWT-based auth without server-side sessions, logout is client-side
    // The client should discard the tokens
    // In production, you would add the jti to a blacklist in Redis

    logger.info({
      requestId,
      userId: authReq.user?.id,
    }, 'User logout');

    res.status(200).json({
      message: 'Logged out successfully',
    });
  }
);

export default router;
