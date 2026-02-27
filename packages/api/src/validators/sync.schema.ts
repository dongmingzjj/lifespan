import { z } from 'zod';

// ============================================================================
// Authentication Schemas
// ============================================================================

export const RegisterSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must not exceed 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens, and underscores'),
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
  password: z.string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must not exceed 128 characters'),
  device_name: z.string()
    .min(1, 'Device name is required')
    .max(100, 'Device name must not exceed 100 characters')
    .optional(),
});

export const LoginSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z.string()
    .min(1, 'Password is required'),
  device_name: z.string()
    .min(1, 'Device name is required')
    .max(100, 'Device name must not exceed 100 characters')
    .optional(),
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string()
    .min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

// ============================================================================
// Sync Event Schemas
// ============================================================================

export const EncryptedEventSchema = z.object({
  id: z.string().uuid('Invalid event ID format'),
  event_type: z.enum(['app_usage', 'web_activity', 'file_activity', 'communication'], {
    errorMap: () => ({ message: 'Invalid event type' }),
  }),
  timestamp: z.number()
    .int('Timestamp must be an integer')
    .min(0, 'Timestamp cannot be negative')
    .max(Date.now() + 60000, 'Timestamp cannot be in the future (more than 1 minute)'),
  duration: z.number()
    .int('Duration must be an integer')
    .min(0, 'Duration cannot be negative')
    .max(86400, 'Duration cannot exceed 24 hours (86400 seconds)'),
  encrypted_data: z.string()
    .max(1024 * 1024, 'Encrypted data cannot exceed 1MB'), // Base64 encoded
  nonce: z.string()
    .length(24, 'Nonce must be 24 characters (12 bytes in hex)'), // 12 bytes in hex
  tag: z.string()
    .length(24, 'Auth tag must be 24 characters (16 bytes base64 with padding)'), // 16 bytes base64
  // Optional searchable plaintext fields
  app_name: z.string().max(255).optional(),
  category: z.enum(['work', 'communication', 'entertainment', 'learning', 'utility', 'other']).optional(),
  domain: z.string().max(255).optional(),
});

export const UploadEventsSchema = z.object({
  device_id: z.string().uuid('Invalid device ID format'),
  events: z.array(EncryptedEventSchema)
    .min(1, 'At least one event is required')
    .max(100, 'Cannot upload more than 100 events at once'),
  last_sync_at: z.number()
    .int('Last sync timestamp must be an integer')
    .min(0, 'Last sync timestamp cannot be negative')
    .optional(),
});

export const DownloadEventsSchema = z.object({
  since: z.coerce.number()
    .int('Since timestamp must be an integer')
    .min(0, 'Since timestamp cannot be negative')
    .optional(),
  limit: z.coerce.number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(1000, 'Limit cannot exceed 1000')
    .default(100),
});

export type EncryptedEvent = z.infer<typeof EncryptedEventSchema>;
export type UploadEventsInput = z.infer<typeof UploadEventsSchema>;
export type DownloadEventsInput = z.infer<typeof DownloadEventsSchema>;

// ============================================================================
// Response Schemas
// ============================================================================

export const SyncStatusSchema = z.object({
  device_id: z.string().uuid(),
  last_sync_at: z.number().nullable(),
  pending_count: z.number().int().min(0),
  synced_count: z.number().int().min(0),
});

export type SyncStatusResponse = z.infer<typeof SyncStatusSchema>;

// ============================================================================
// Device Schemas
// ============================================================================

export const RegisterDeviceSchema = z.object({
  device_name: z.string()
    .min(1, 'Device name is required')
    .max(100, 'Device name must not exceed 100 characters'),
  device_type: z.enum(['windows', 'android', 'ios', 'macos', 'linux'], {
    errorMap: () => ({ message: 'Invalid device type' }),
  }),
  device_id: z.string()
    .min(1, 'Device ID is required')
    .max(255, 'Device ID must not exceed 255 characters'),
  os_version: z.string().max(50).optional(),
  app_version: z.string().max(20).optional(),
});

export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;
