-- Migration 003: Add Analysis Tables
-- This migration adds tables for user portraits and AI recommendations

-- ============================================================================
-- User Portraits Table
-- Stores generated user behavioral profiles
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_portraits (
    -- Primary key
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- Portrait data (JSON)
    portrait_data JSONB NOT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT user_portraits_json_valid CHECK (portrait_data IS NOT NULL AND jsonb_typeof(portrait_data) = 'object')
);

-- Index for updated_at queries
CREATE INDEX IF NOT EXISTS idx_user_portraits_updated ON user_portraits(updated_at DESC);

-- Comment
COMMENT ON TABLE user_portraits IS 'Stores AI-generated user behavioral profiles';
COMMENT ON COLUMN user_portraits.portrait_data IS 'JSONB data containing work style, peak hours, productivity score, etc.';

-- ============================================================================
-- Recommendations Table
-- Stores AI-generated productivity recommendations
-- ============================================================================

CREATE TABLE IF NOT EXISTS recommendations (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- User relation
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Recommendation details
    type VARCHAR(50) NOT NULL CHECK (type IN ('productivity', 'health', 'time_management', 'focus', 'habit')),
    priority VARCHAR(10) NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,

    -- Actionable steps (JSON array)
    actionable_steps JSONB NOT NULL DEFAULT '[]',

    -- Expected impact
    expected_impact TEXT,

    -- Status
    is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT recommendations_steps_valid CHECK (actionable_steps IS NOT NULL AND jsonb_typeof(actionable_steps) = 'array')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recommendations_user ON recommendations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_type ON recommendations(type, priority);
CREATE INDEX IF NOT EXISTS idx_recommendations_dismissed ON recommendations(user_id, is_dismissed);

-- Comments
COMMENT ON TABLE recommendations IS 'Stores AI-generated productivity recommendations for users';
COMMENT ON COLUMN recommendations.type IS 'Type of recommendation: productivity, health, time_management, focus, or habit';
COMMENT ON COLUMN recommendations.priority IS 'Priority level: high, medium, or low';
COMMENT ON COLUMN recommendations.actionable_steps IS 'JSON array of actionable steps';

-- ============================================================================
-- Trigger: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to user_portraits
DROP TRIGGER IF EXISTS update_user_portraits_updated_at ON user_portraits;
CREATE TRIGGER update_user_portraits_updated_at
    BEFORE UPDATE ON user_portraits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to recommendations
DROP TRIGGER IF EXISTS update_recommendations_updated_at ON recommendations;
CREATE TRIGGER update_recommendations_updated_at
    BEFORE UPDATE ON recommendations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Grant Permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON user_portraits TO lifespan;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations TO lifespan;
GRANT USAGE, SELECT ON SEQUENCE recommendations_id_seq TO lifespan;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Migration 003: Analysis tables created successfully!';
END $$;
