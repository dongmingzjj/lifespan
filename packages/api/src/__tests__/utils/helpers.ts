/**
 * Test Helper Functions
 *
 * Utility functions for testing that don't require database setup
 */

import { v4 as uuidv4 } from 'uuid';
import { generateAccessToken } from '../../middleware/auth.js';

/**
 * Generate a valid JWT token for testing
 */
export function generateTestToken(userId: string, deviceId?: string): string {
  return generateAccessToken({
    sub: userId,
    device_id: deviceId || uuidv4(),
  });
}

/**
 * Generate a mock user object
 */
export function mockUser(overrides: Partial<{
  id: string;
  username: string;
  email: string;
}> = {}) {
  return {
    id: overrides.id || uuidv4(),
    username: overrides.username || 'testuser',
    email: overrides.email || 'test@example.com',
  };
}

/**
 * Generate mock event data
 */
export function mockEvent(overrides: Partial<{
  id: string;
  event_type: string;
  timestamp: number;
  duration: number;
}> = {}) {
  return {
    id: overrides.id || uuidv4(),
    event_type: overrides.event_type || 'app_usage',
    timestamp: overrides.timestamp || Date.now(),
    duration: overrides.duration || 300,
    encrypted_data: 'encrypted_data_here',
    nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6',
    tag: 'auth_tag_here_16bytes_base',
    app_name: 'TestApp',
    category: 'work',
  };
}

/**
 * Generate multiple mock events
 */
export function mockEvents(count: number): any[] {
  return Array.from({ length: count }, (_, i) => ({
    ...mockEvent({
      timestamp: Date.now() + i * 1000,
      duration: 300 * (i + 1),
    }),
  }));
}

/**
 * Wait for a specified amount of time (ms)
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 100
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await wait(delay);
    }
  }
  throw new Error('Max attempts reached');
}

/**
 * Create a mock request object
 */
export function mockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    headers: {},
    ip: '127.0.0.1',
    path: '/api/v1/test',
    method: 'GET',
    ...overrides,
  };
}

/**
 * Create a mock response object
 */
export function mockResponse(): any {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    getHeader: jest.fn(),
  };
  return res;
}

/**
 * Create a mock next function
 */
export function mockNext(): jest.Mock {
  return jest.fn();
}

/**
 * Assert that an async function throws a specific error
 */
export async function expectThrow<TError extends Error = Error>(
  fn: () => Promise<any>,
  errorClass: new (...args: any[]) => TError
): Promise<TError> {
  try {
    await fn();
    throw new Error(`Expected function to throw ${errorClass.name}, but it didn't throw`);
  } catch (error) {
    if (error instanceof errorClass) {
      return error;
    }
    throw error;
  }
}

/**
 * Generate a random test email
 */
export function testEmail(): string {
  return `test-${Date.now()}@example.com`;
}

/**
 * Generate a random test username
 */
export function testUsername(): string {
  return `testuser_${Date.now()}`;
}
