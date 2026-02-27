/**
 * Authentication API Integration Tests
 *
 * Tests the complete authentication flow including:
 * - User registration
 * - User login
 * - Token refresh
 * - Logout
 * - Error handling
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../../index.js';
import { generateAccessToken } from '../../middleware/auth.js';
import { createTestUser, createTestDevice } from '../setup.js';

describe('Authentication API', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user with valid data', async () => {
      const userData = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'SecurePassword123!',
        device_name: 'Test Device',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user_id');
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body).toHaveProperty('device_id');

      // Verify user ID is valid UUID
      expect(() => {
        uuidv4();
        const uuid = response.body.user_id;
        // Simple UUID format check
        expect(typeof uuid).toBe('string');
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      }).not.toThrow();
    });

    it('should reject registration with existing email', async () => {
      const userData = {
        username: 'testuser1',
        email: 'duplicate@example.com',
        password: 'SecurePassword123!',
      };

      // Register first user
      await request(app)
        .post('/api/v1/auth/register')
        .send(userData);

      // Try to register with same email
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...userData,
          username: 'testuser2',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('conflict');
      expect(response.body.message).toContain('Email already registered');
    });

    it('should reject registration with existing username', async () => {
      const userData = {
        username: 'duplicateuser',
        email: 'user1@example.com',
        password: 'SecurePassword123!',
      };

      // Register first user
      await request(app)
        .post('/api/v1/auth/register')
        .send(userData);

      // Try to register with same username
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...userData,
          email: 'user2@example.com',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('conflict');
      expect(response.body.message).toContain('Username already taken');
    });

    it('should reject registration with invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          email: 'invalid-email',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with short password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'short',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with short username', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'ab',
          email: 'test@example.com',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(400);
    });

    it('should reject registration with invalid username characters', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'user@name!',
          email: 'test@example.com',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      // Create a test user before each login test
      await createTestUser({
        username: 'loginuser',
        email: 'login@example.com',
        password: 'LoginPassword123!',
      });
    });

    it('should login with correct credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@example.com',
          password: 'LoginPassword123!',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('username');
      expect(response.body.user).toHaveProperty('email');
      expect(response.body.user.email).toBe('login@example.com');
    });

    it('should reject login with wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@example.com',
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_credentials');
      expect(response.body.message).toContain('Invalid email or password');
    });

    it('should reject login with non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_credentials');
    });

    it('should reject login with invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'invalid-email',
          password: 'SomePassword123!',
        });

      expect(response.status).toBe(400);
    });

    it('should reject login with missing password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@example.com',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let validRefreshToken: string;
    let testUserId: string;

    beforeEach(async () => {
      // Create test user and get valid token
      const user = await createTestUser({
        username: 'refreshuser',
        email: 'refresh@example.com',
        password: 'RefreshPassword123!',
      });
      testUserId = user.id;

      validRefreshToken = generateAccessToken({
        sub: user.id,
        device_id: uuidv4(),
      });
    });

    it('should refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refresh_token: validRefreshToken,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(typeof response.body.access_token).toBe('string');
      expect(typeof response.body.refresh_token).toBe('string');
    });

    it('should reject refresh with invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refresh_token: 'invalid.token.here',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_token');
    });

    it('should reject refresh with missing token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully with valid token', async () => {
      // Create user and device
      const user = await createTestUser({
        username: 'logoutuser',
        email: 'logout@example.com',
        password: 'LogoutPassword123!',
      });
      const deviceId = await createTestDevice({
        userId: user.id,
        deviceName: 'Test Device',
        deviceType: 'windows',
      });

      const token = generateAccessToken({
        sub: user.id,
        device_id: deviceId,
      });

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Logged out successfully');
    });

    it('should reject logout without auth token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });
  });

  describe('Authentication End-to-End Flow', () => {
    it('should complete full authentication cycle', async () => {
      const userData = {
        username: 'fullcycleuser',
        email: 'fullcycle@example.com',
        password: 'FullCyclePassword123!',
        device_name: 'My Laptop',
      };

      // Step 1: Register
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(userData);

      expect(registerResponse.status).toBe(201);
      const { access_token, refresh_token, user_id } = registerResponse.body;

      // Step 2: Login (should work)
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body).toHaveProperty('access_token');

      // Step 3: Refresh token
      const refreshResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refresh_token: refresh_token,
        });

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body).toHaveProperty('access_token');

      // Step 4: Logout
      const logoutResponse = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${access_token}`);

      expect(logoutResponse.status).toBe(200);
    });
  });
});
