/**
 * Authentication Middleware Unit Tests
 *
 * Tests the authentication middleware including:
 * - Token generation
 * - Token verification
 * - Auth middleware
 * - Error handling
 */

import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  authMiddleware,
} from '../../middleware/auth.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { Request, Response, NextFunction } from 'express';

// Mock the logger
jest.mock('../../utils/logger.js');
const mockLogger = require('../../utils/logger.js');

describe('Authentication Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    // Set valid JWT secret for tests
    process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

    mockReq = {
      headers: {},
      ip: '127.0.0.1',
      path: '/api/v1/test',
      method: 'GET',
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.JWT_SECRET;
  });

  describe('generateAccessToken', () => {
    it('should generate a valid access token', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('should include correct payload in token', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyToken(token);

      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.device_id).toBe(payload.device_id);
      expect(decoded.jti).toBe(payload.jti);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should use default expiry of 7 days', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyToken(token);

      const now = Math.floor(Date.now() / 1000);
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;

      // Check expiry is approximately 7 days from now
      expect(decoded.exp - decoded.iat).toBe(sevenDaysInSeconds);
    });

    it('should use custom expiry from env', () => {
      process.env.JWT_ACCESS_EXPIRY = '1h';

      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyToken(token);

      // Check expiry is 1 hour
      expect(decoded.exp - decoded.iat).toBe(3600);

      delete process.env.JWT_ACCESS_EXPIRY;
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateRefreshToken(payload);

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should have longer expiry than access token', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      const accessDecoded = verifyToken(accessToken);
      const refreshDecoded = verifyToken(refreshToken);

      // Refresh token should live longer
      expect(refreshDecoded.exp - refreshDecoded.iat).toBeGreaterThan(
        accessDecoded.exp - accessDecoded.iat
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);
      const decoded = verifyToken(token);

      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.device_id).toBe(payload.device_id);
    });

    it('should throw error for invalid token', () => {
      expect(() => {
        verifyToken('invalid.token.here');
      }).toThrow(UnauthorizedError);
    });

    it('should throw error for malformed token', () => {
      expect(() => {
        verifyToken('not-a-jwt');
      }).toThrow(UnauthorizedError);
    });

    it('should throw error for empty token', () => {
      expect(() => {
        verifyToken('');
      }).toThrow(UnauthorizedError);
    });
  });

  describe('authMiddleware', () => {
    it('should authenticate valid token', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);
      mockReq.headers = {
        authorization: `Bearer ${token}`,
      };

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should attach user info to request', () => {
      const payload = {
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      };

      const token = generateAccessToken(payload);
      mockReq.headers = {
        authorization: `Bearer ${token}`,
      };

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as any).user).toBeDefined();
      expect((mockReq as any).user.id).toBe(payload.sub);
      expect((mockReq as any).user.deviceId).toBe(payload.device_id);
      expect((mockReq as any).user.jti).toBe(payload.jti);
    });

    it('should reject missing authorization header', () => {
      mockReq.headers = {};

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    });

    it('should reject malformed authorization header', () => {
      mockReq.headers = {
        authorization: 'InvalidFormat token',
      };

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject token without Bearer prefix', () => {
      const token = generateAccessToken({
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      });

      mockReq.headers = {
        authorization: token,
      };

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject invalid token', () => {
      mockReq.headers = {
        authorization: 'Bearer invalid.token.here',
      };

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: expect.any(String),
      });
    });

    it('should reject empty token', () => {
      mockReq.headers = {
        authorization: 'Bearer ',
      };

      authMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('JWT Secret Validation', () => {
    it('should throw error when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;

      expect(() => {
        generateAccessToken({
          sub: 'user-123',
          device_id: 'device-123',
          jti: 'token-123',
        });
      }).toThrow('JWT_SECRET environment variable is not set');
    });

    it('should throw error when JWT_SECRET is too short', () => {
      process.env.JWT_SECRET = 'short';

      expect(() => {
        generateAccessToken({
          sub: 'user-123',
          device_id: 'device-123',
          jti: 'token-123',
        });
      }).toThrow('JWT_SECRET must be at least 32 characters long');
    });

    it('should warn when using default insecure secret', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      process.env.JWT_SECRET = 'your-secret-key-change-in-production';

      generateAccessToken({
        sub: 'user-123',
        device_id: 'device-123',
        jti: 'token-123',
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Using default/insecure JWT secret!')
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
