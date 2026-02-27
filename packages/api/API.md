# Lifespan API Documentation

Backend API for the Lifespan Extension Project - User authentication, event synchronization, and behavior analysis.

**Base URL**: `http://localhost:3000/api/v1`

**API Version**: v1

---

## Table of Contents

1. [Authentication](#authentication)
2. [Sync API](#sync-api)
3. [Analysis API](#analysis-api)
4. [Health Check](#health-check)
5. [Error Codes](#error-codes)
6. [Rate Limiting](#rate-limiting)
7. [Data Models](#data-models)

---

## Authentication

### Overview

The API uses JWT (JSON Web Token) based authentication. All protected endpoints require a valid access token in the `Authorization` header.

### Token Types

| Token Type | Purpose | Expiry | Usage |
|------------|---------|--------|-------|
| **Access Token** | API authentication | 7 days (configurable) | Sent in Authorization header |
| **Refresh Token** | Token renewal | 30 days (configurable) | Used to get new access token |

### Authorization Header

```http
Authorization: Bearer <access_token>
```

### Environment Variables

```bash
# JWT Configuration
JWT_SECRET=your-secret-key-min-32-chars
JWT_ACCESS_EXPIRY=7d        # Access token expiry (default: 7d)
JWT_REFRESH_EXPIRY=30d      # Refresh token expiry (default: 30d)
```

---

## Authentication Endpoints

### 1. Register User

Register a new user account.

**Endpoint**: `POST /api/v1/auth/register`

**Rate Limit**: 5 requests per minute

**Request Body**:

```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "SecurePassword123!",
  "device_name": "My Windows PC" // optional
}
```

**Field Validation**:

| Field | Type | Constraints |
|-------|------|-------------|
| `username` | string | 3-50 chars, alphanumeric, hyphens, underscores |
| `email` | string | Valid email, max 255 chars |
| `password` | string | Min 12 chars, max 128 chars |
| `device_name` | string | Optional, 1-100 chars |

**Response** (201 Created):

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "device_id": "660e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**:

- `409 Conflict` - Email or username already exists
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

---

### 2. Login

Authenticate with email and password.

**Endpoint**: `POST /api/v1/auth/login`

**Rate Limit**: 5 requests per minute

**Request Body**:

```json
{
  "email": "john@example.com",
  "password": "SecurePassword123!",
  "device_name": "My Windows PC" // optional, defaults to "Unknown Device"
}
```

**Response** (200 OK):

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "johndoe",
    "email": "john@example.com"
  }
}
```

**Error Responses**:

- `401 Unauthorized` - Invalid credentials
- `401 Unauthorized` - Account inactive
- `429 Too Many Requests` - Rate limit exceeded

---

### 3. Refresh Token

Get new access and refresh tokens.

**Endpoint**: `POST /api/v1/auth/refresh`

**Rate Limit**: 5 requests per minute

**Request Body**:

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (200 OK):

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses**:

- `401 Unauthorized` - Invalid or expired token
- `401 Unauthorized` - User account inactive

---

### 4. Logout

Logout the current user (client-side token discard).

**Endpoint**: `POST /api/v1/auth/logout`

**Authentication**: Required

**Request**:

```http
Authorization: Bearer <access_token>
```

**Response** (200 OK):

```json
{
  "message": "Logged out successfully"
}
```

**Note**: JWT-based auth is stateless. The client should discard the tokens. In production, implement token blacklisting with Redis.

---

## Sync API

### Overview

The Sync API handles event synchronization between client devices and the server. All sync endpoints require authentication.

### Event Data Flow

```
Client Device (Windows/Android)
  ↓ [Upload Events]
Server (PostgreSQL)
  ↓ [Download Events]
Client Device
```

### Sync Endpoints

### 1. Upload Events

Upload encrypted events from client to server with conflict resolution.

**Endpoint**: `POST /api/v1/sync/events`

**Authentication**: Required

**Rate Limit**: 100 requests per minute

**Request Headers**:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body**:

```json
{
  "device_id": "660e8400-e29b-41d4-a716-446655440000",
  "events": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "event_type": "app_usage",
      "timestamp": 1709078400000,
      "duration": 3600,
      "encrypted_data": "base64-encoded-encrypted-payload",
      "nonce": "00112233445566778899aabb",
      "tag": "authentication-tag-base64url",
      "app_name": "Visual Studio Code",
      "category": "work"
    }
  ],
  "last_sync_at": 1709074800000
}
```

**Event Validation**:

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string (UUID) | Valid UUID v4 |
| `event_type` | string | One of: `app_usage`, `web_activity`, `file_activity`, `communication` |
| `timestamp` | number (int64) | Unix timestamp in ms, not in future (>1min) |
| `duration` | number (int) | Duration in seconds, 0-86400 (max 24h) |
| `encrypted_data` | string | Base64 encoded, max 1MB |
| `nonce` | string | 24 chars (12 bytes in hex) |
| `tag` | string | 24 chars (16 bytes base64 with padding) |
| `app_name` | string | Optional, max 255 chars |
| `category` | string | Optional: work, communication, entertainment, learning, utility, other |
| `domain` | string | Optional, max 255 chars (for web_activity) |

**Batch Limits**:
- Min 1 event per request
- Max 100 events per request

**Response** (200 OK - Success):

```json
{
  "synced_at": 1709078400000,
  "processed_count": 50,
  "conflicts": []
}
```

**Response** (409 Conflict - Conflicts Detected):

```json
{
  "error": "sync_conflict",
  "message": "Some events have conflicts on the server",
  "resolution": "last_write_wins",
  "processed_count": 45,
  "conflicts": [
    {
      "event_id": "770e8400-e29b-41d4-a716-446655440000",
      "server_version": {
        "id": "770e8400-e29b-41d4-a716-446655440000",
        "timestamp": "2024-02-27T10:00:00.000Z",
        "encrypted_data": "server-encrypted-data"
      }
    }
  ],
  "synced_at": 1709078400000
}
```

**Conflict Resolution**: Last-write-wins based on timestamp

**Error Responses**:
- `400 Bad Request` - Validation error
- `401 Unauthorized` - Invalid token
- `404 Not Found` - Device not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Database error

---

### 2. Download Events

Download events from server to client (incremental sync).

**Endpoint**: `GET /api/v1/sync/events`

**Authentication**: Required

**Rate Limit**: 100 requests per minute

**Query Parameters**:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `since` | number (int64) | - | Optional timestamp for incremental sync |
| `limit` | number (int) | 100 | 1-1000 |

**Request**:

```http
GET /api/v1/sync/events?since=1709074800000&limit=100
Authorization: Bearer <access_token>
```

**Response** (200 OK):

```json
{
  "events": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "event_type": "app_usage",
      "timestamp": 1709078400000,
      "duration": 3600,
      "encrypted_data": "base64-encoded-encrypted-payload",
      "nonce": "00112233445566778899aabb",
      "tag": "authentication-tag-base64url",
      "app_name": "Visual Studio Code",
      "category": "work"
    }
  ],
  "has_more": true,
  "latest_timestamp": 1709082000000
}
```

**Error Responses**:
- `400 Bad Request` - Invalid query parameters
- `401 Unauthorized` - Invalid token
- `404 Not Found` - Device not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Database error

---

### 3. Get Sync Status

Get sync status for the current user/device.

**Endpoint**: `GET /api/v1/sync/status`

**Authentication**: Required

**Rate Limit**: 100 requests per minute

**Request**:

```http
GET /api/v1/sync/status
Authorization: Bearer <access_token>
```

**Response** (200 OK):

```json
{
  "device_id": "660e8400-e29b-41d4-a716-446655440000",
  "last_sync_at": 1709078400000,
  "pending_count": 0,
  "synced_count": 15234
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid token
- `404 Not Found` - User or device not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Database error

---

## Analysis API

### Overview

The Analysis API provides AI-powered behavior analysis, user portraits, and productivity recommendations.

### Analysis Endpoints

### 1. Get Behavior Insights

Get behavior insights for the current user.

**Endpoint**: `GET /api/v1/analysis/insights`

**Authentication**: Required

**Rate Limit**: 20 requests per hour (AI is expensive)

**Query Parameters**:

| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `force_refresh` | boolean | false | Force regeneration of insights |
| `days` | number (int) | 30 | 1-90 days of data to analyze |
| `max_cache_age` | number (int) | - | Optional max cache age in seconds |

**Request**:

```http
GET /api/v1/analysis/insights?days=30&force_refresh=false
Authorization: Bearer <access_token>
```

**Response** (200 OK):

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "insights": {
    "work_style": "deep_work",
    "peak_hours": ["09:00-12:00", "14:00-17:00"],
    "top_apps": [
      {"app_name": "Visual Studio Code", "duration": 14400, "percentage": 35},
      {"app_name": "Chrome", "duration": 7200, "percentage": 18}
    ],
    "productivity_trend": "improving"
  },
  "portrait": {
    "work_style": "deep_work",
    "productivity_score": 75,
    "focus_score": 80,
    "work_hours": "09:00-18:00"
  },
  "recommendations": [
    {
      "type": "schedule",
      "title": "Optimize meeting schedule",
      "description": "Consider moving meetings to afternoon..."
    }
  ],
  "last_updated": 1709078400000
}
```

**Error Responses**:
- `400 Bad Request` - Invalid query parameters
- `401 Unauthorized` - Invalid token
- `404 Not Found` - Insufficient data
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Database or AI error

---

### 2. Generate User Portrait

Generate a new user portrait.

**Endpoint**: `POST /api/v1/analysis/portrait`

**Authentication**: Required

**Rate Limit**: 20 requests per hour

**Request Body**:

```json
{
  "days": 30
}
```

**Response** (200 OK):

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "work_style": "deep_work",
  "productivity_score": 75,
  "focus_score": 80,
  "work_hours": "09:00-18:00",
  "peak_productivity_time": "09:00-12:00",
  "break_patterns": ["15:00-15:30"],
  "version": 1,
  "created_at": 1709078400000
}
```

**Error Responses**:
- `400 Bad Request` - Invalid request body
- `401 Unauthorized` - Invalid token
- `404 Not Found` - Insufficient data
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Database or AI error

---

### 3. Get Recommendations

Get AI-powered productivity recommendations.

**Endpoint**: `GET /api/v1/analysis/recommendations`

**Authentication**: Required

**Rate Limit**: 20 requests per hour

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `force_refresh` | boolean | false | Force regeneration |

**Request**:

```http
GET /api/v1/analysis/recommendations?force_refresh=false
Authorization: Bearer <access_token>
```

**Response** (200 OK):

```json
{
  "recommendations": [
    {
      "id": "rec-001",
      "type": "schedule",
      "priority": "high",
      "title": "Optimize meeting schedule",
      "description": "Consider moving meetings to afternoon to preserve morning deep work time.",
      "actionable": true,
      "created_at": 1709078400000
    }
  ],
  "count": 1,
  "last_updated": 1709078400000
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid token
- `404 Not Found` - No recommendations available
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Database or AI error

---

## Health Check

### Get Health Status

Check API and database health.

**Endpoint**: `GET /health`

**Authentication**: Not Required

**Response** (200 OK):

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2024-02-27T10:00:00.000Z"
}
```

---

## Error Codes

### Standard Error Response Format

All error responses follow this structure:

```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "details": {
    // Additional error-specific details
  }
}
```

### Error Codes Reference

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| `400` | `validation_error` | Request validation failed |
| `401` | `unauthorized` | Authentication required or failed |
| `401` | `invalid_credentials` | Invalid email or password |
| `401` | `invalid_token` | Token expired or invalid |
| `403` | `forbidden` | Insufficient permissions |
| `404` | `not_found` | Resource not found |
| `409` | `conflict` | Resource already exists |
| `409` | `sync_conflict` | Event sync conflict detected |
| `429` | `rate_limit_exceeded` | Too many requests |
| `500` | `internal_error` | Internal server error |
| `500` | `database_error` | Database operation failed |

### Validation Error Details

When validation fails, the response includes field-specific errors:

```json
{
  "error": "validation_error",
  "message": "Validation failed",
  "fields": {
    "email": "Invalid email address",
    "password": "Password must be at least 12 characters"
  }
}
```

---

## Rate Limiting

### Rate Limit Strategy

The API uses in-memory rate limiting (Redis recommended for production).

### Rate Limits by Endpoint

| Endpoint Pattern | Rate Limit | Window |
|------------------|------------|--------|
| `/api/v1/auth/*` | 5 requests | 1 minute |
| `/api/v1/sync/*` | 100 requests | 1 minute |
| `/api/v1/analysis/*` | 20 requests | 1 hour |
| All other API routes | 1000 requests | 1 hour |

### Rate Limit Headers

All rate-limited responses include these headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-02-27T11:00:00.000Z
Retry-After: 30
```

### Rate Limit Error Response

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Try again in 30 seconds.",
  "details": {
    "retry_after": 30,
    "limit": 100,
    "window": 60
  }
}
```

---

## Data Models

### User

```typescript
interface User {
  id: string;              // UUID v4
  username: string;        // 3-50 chars
  email: string;           // Valid email
  is_active: boolean;      // Account status
  is_verified: boolean;    // Email verification status
  created_at: Date;        // Account creation time
  last_sync_at: Date;      // Last sync timestamp
}
```

### Device

```typescript
interface Device {
  id: string;              // Device UUID
  user_id: string;         // Owner user ID
  device_name: string;     // Human-readable name
  device_type: 'windows' | 'android' | 'ios' | 'macos' | 'linux';
  is_active: boolean;      // Device status
  last_seen_at: Date;      // Last activity
  created_at: Date;
}
```

### Event

```typescript
interface EncryptedEvent {
  id: string;              // Event UUID
  user_id: string;         // Owner user ID
  device_id: string;       // Source device
  event_type: 'app_usage' | 'web_activity' | 'file_activity' | 'communication';
  timestamp: number;       // Unix timestamp in ms
  duration: number;        // Duration in seconds
  encrypted_data: string;  // Base64 encrypted payload
  iv: string;              // Initialization vector (nonce)
  auth_tag: string;        // Authentication tag
  app_name?: string;       // Plain app name (searchable)
  category?: string;       // Event category
  domain?: string;         // Domain for web_activity
  synced_at: Date;         // Server sync time
}
```

### Sync Record

```typescript
interface SyncRecord {
  id: string;              // Sync record UUID
  user_id: string;         // User ID
  device_id: string;       // Device ID
  sync_type: 'upload' | 'download';
  events_count: number;    // Number of events synced
  status: 'success' | 'failed' | 'partial';
  start_time: Date;
  end_time: Date;
  created_at: Date;
}
```

---

## Security Considerations

### Encryption

- **Password Storage**: bcrypt with cost factor 12
- **Data at Rest**: Encrypted in PostgreSQL (AES-256-GCM)
- **Data in Transit**: HTTPS in production

### JWT Security

- **Secret Key**: Minimum 32 characters (use `openssl rand -base64 48`)
- **Token Expiry**: Access tokens expire in 7 days
- **Algorithm**: HS256 (HMAC-SHA256)

### Best Practices

1. **Always use HTTPS** in production
2. **Rotate JWT secrets** regularly
3. **Implement token blacklisting** for logout
4. **Use Redis** for distributed rate limiting
5. **Sanitize error messages** in production
6. **Monitor for suspicious activity**
7. **Keep dependencies updated**

---

## Testing

### Unit Tests

```bash
npm run test:unit
```

### Integration Tests

```bash
npm run test:integration
```

### Test Coverage

```bash
npm run test:coverage
```

---

## Development

### Run Dev Server

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

### Type Check

```bash
npm run typecheck
```

---

## Environment Variables

```bash
# Server
PORT=3000
API_VERSION=v1
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lifespan
DB_USER=lifespan
DB_PASSWORD=your-password
# Or use DATABASE_URL

# JWT
JWT_SECRET=your-secret-key-min-32-chars
JWT_ACCESS_EXPIRY=7d
JWT_REFRESH_EXPIRY=30d

# CORS
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# Redis (optional, for production rate limiting)
REDIS_URL=redis://localhost:6379

# AI Service (Zhipu AI)
ZHIPU_API_KEY=your-zhipu-api-key
```

---

## Support

For issues, questions, or contributions:

- **GitHub Issues**: [lifespan/issues](https://github.com/your-org/lifespan/issues)
- **Documentation**: [Lifespan Docs](../../docs/)

---

**Last Updated**: 2026-02-27

**API Version**: v1.0.0
