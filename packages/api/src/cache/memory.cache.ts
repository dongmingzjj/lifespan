import { logger } from '../utils/logger.js';

/**
 * Simple in-memory cache for device information
 * TODO: Replace with Redis in production
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class InMemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTTL: number; // milliseconds

  constructor(defaultTTL: number = 300000) { // 5 minutes default
    this.defaultTTL = defaultTTL;

    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key: string, data: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
    this.cache.set(key, { data, expiresAt });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    let deleted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug({ deleted, remaining: this.cache.size }, 'Cache cleanup completed');
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

export interface DeviceInfo {
  id: string;
  userId: string;
  isActive: boolean;
  lastSeenAt: Date;
}

// Device info cache (5 minute TTL)
export const deviceCache = new InMemoryCache<DeviceInfo>(300000);

// User info cache (5 minute TTL)
export const userCache = new InMemoryCache<{ id: string; lastSyncAt: Date | null }>(300000);

// JWT blacklist cache (token revocation, TTL based on token expiry)
export const jwtBlacklist = new InMemoryCache<{ jti: string; revokedAt: Date }>(0);
