-- ============================================================================
-- Lifespan Database Schema - Simplified Version
-- PostgreSQL 16+
-- ============================================================================

-- Set client encoding to UTF8
SET client_encoding = 'UTF8';

-- ============================================================================
-- Users Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_sync_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,

    -- Indexes
    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_last_sync ON users(last_sync_at);

-- ============================================================================
-- Devices Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(50) NOT NULL, -- 'windows', 'android', 'web'
    device_info JSONB, -- Device specifications
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint: one device per device_type per user
    UNIQUE(user_id, device_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(user_id, is_active) WHERE is_active = true;

-- ============================================================================
-- Events Table (Partitioned by Month)
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,

    -- Event data
    event_type VARCHAR(50) NOT NULL, -- 'app_usage', 'web_activity', 'file_activity'
    timestamp TIMESTAMPTZ NOT NULL,
    duration INTEGER NOT NULL, -- seconds

    -- Encrypted payload (sensitive data)
    encrypted_data TEXT NOT NULL,
    iv TEXT NOT NULL, -- Initialization vector
    auth_tag TEXT, -- Authentication tag for GCM

    -- Plaintext fields (for searching and filtering)
    app_name VARCHAR(255),
    category VARCHAR(50), -- 'work', 'entertainment', 'communication', etc.
    domain VARCHAR(255), -- for web activity

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Partition by month
-- Note: This will be implemented after initial data insertion
-- CREATE TABLE events_y2024m01 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_user_timestamp ON events(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_name ON events(app_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_domain ON events(domain, timestamp DESC);

-- Partial index for recent events (last 30 days)
CREATE INDEX IF NOT EXISTS idx_events_recent ON events(user_id, timestamp DESC)
WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days';

-- ============================================================================
-- Sync Records Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,

    sync_type VARCHAR(20) NOT NULL, -- 'upload', 'download'
    events_count INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'partial'

    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    error_message TEXT,
    metadata JSONB,

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sync_records_user_id ON sync_records(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_records_device_id ON sync_records(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_records_status ON sync_records(status, created_at DESC);

-- ============================================================================
-- Insert Test Data
-- ============================================================================

-- Insert a test user (password: Test123!)
-- Note: In production, use bcrypt to hash passwords
INSERT INTO users (username, email, password_hash) VALUES
('testuser', 'test@lifespan.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyWpH5HyZ')
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- Functions for Future Use
-- ============================================================================

-- Function to get user's events for a date range
CREATE OR REPLACE FUNCTION get_user_events(
    p_user_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
) RETURNS TABLE (
    id UUID,
    event_type VARCHAR(50),
    timestamp TIMESTAMPTZ,
    duration INTEGER,
    app_name VARCHAR(255),
    category VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.event_type,
        e.timestamp,
        e.duration,
        e.app_name,
        e.category
    FROM events e
    WHERE e.user_id = p_user_id
        AND e.timestamp >= p_start_date
        AND e.timestamp <= p_end_date
    ORDER BY e.timestamp DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

-- Grant all permissions on tables to lifespan user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lifespan;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO lifespan;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lifespan;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Database schema created successfully!';
    RAISE NOTICE 'Tables: users, devices, events, sync_records';
    RAISE NOTICE 'Indexes: Created for optimal query performance';
    RAISE NOTICE 'Test user: testuser / test@lifespan.local';
END $$;
