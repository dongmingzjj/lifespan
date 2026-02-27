-- Fix 1: Remove the problematic index (not critical)
DROP INDEX IF EXISTS idx_events_recent;

-- Fix 2: Create the function with proper syntax
CREATE OR REPLACE FUNCTION get_user_events(
    p_user_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
) RETURNS TABLE (
    event_id UUID,
    event_type VARCHAR(50),
    event_timestamp TIMESTAMPTZ,
    duration INTEGER,
    app_name VARCHAR(255),
    category VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id AS event_id,
        e.event_type,
        e.timestamp AS event_timestamp,
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

-- Grant permissions again
GRANT EXECUTE ON FUNCTION get_user_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO lifespan;

DO $$
BEGIN
    RAISE NOTICE 'Schema fixes applied successfully!';
END $$;
