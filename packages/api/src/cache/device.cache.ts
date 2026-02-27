import { query } from '../utils/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { DeviceInfo } from './memory.cache.js';
import { deviceCache } from './memory.cache.js';

/**
 * Get device info with caching
 * Returns null if device not found or inactive
 */
export async function getDeviceInfo(deviceId: string): Promise<DeviceInfo | null> {
  // Check cache first
  const cached = deviceCache.get(deviceId);
  if (cached) {
    return cached;
  }

  // Query database
  const result = await query(
    `SELECT id, user_id, is_active, last_seen_at
     FROM devices
     WHERE id = $1 AND is_active = true`,
    [deviceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const device: DeviceInfo = {
    id: result.rows[0].id,
    userId: result.rows[0].user_id,
    isActive: result.rows[0].is_active,
    lastSeenAt: new Date(result.rows[0].last_seen_at),
  };

  // Cache for 5 minutes
  deviceCache.set(deviceId, device);

  return device;
}

/**
 * Verify device belongs to user
 * @throws {NotFoundError} if device not found or inactive
 */
export async function verifyDeviceOwnership(deviceId: string, userId: string): Promise<void> {
  const device = await getDeviceInfo(deviceId);

  if (!device) {
    throw new NotFoundError('Device not found or inactive');
  }

  if (device.userId !== userId) {
    throw new NotFoundError('Device does not belong to user');
  }
}

/**
 * Invalidate device cache (call after device update)
 */
export function invalidateDeviceCache(deviceId: string): void {
  deviceCache.delete(deviceId);
}

/**
 * Clear all caches (useful for testing)
 */
export function clearAllCaches(): void {
  deviceCache.clear();
}
