-- ============================================================================
-- Database Schema Verification Script
-- ============================================================================
-- This script checks if the database schema is properly applied
-- Run this to verify all required columns exist
-- ============================================================================

-- Check users table structure
SELECT
    'users table check' as check_type,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Expected output should include these columns:
-- id (UUID)
-- username (VARCHAR(50))
-- email (VARCHAR(255))
-- password_hash (VARCHAR(255))
-- timezone (VARCHAR(50))
-- language (VARCHAR(10))
-- public_key (TEXT)
-- encryption_version (VARCHAR(20))
-- is_active (BOOLEAN)
-- is_verified (BOOLEAN)  <-- IMPORTANT: This column must exist!
-- created_at (TIMESTAMP WITH TIME ZONE)
-- updated_at (TIMESTAMP WITH TIME ZONE)
-- last_sync_at (TIMESTAMP WITH TIME ZONE)
-- metadata (JSONB)

-- ============================================================================

-- Check devices table structure
SELECT
    'devices table check' as check_type,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'devices'
ORDER BY ordinal_position;

-- Expected columns:
-- id, user_id, device_name, device_type, device_id, os_version,
-- app_version, is_active, last_seen_at, created_at, updated_at

-- ============================================================================

-- Check if pgvector extension is installed
SELECT
    'pgvector extension' as check_type,
    extname,
    extversion
FROM pg_extension
WHERE extname = 'vector';

-- Expected: One row with extname='vector'

-- ============================================================================

-- Check if uuid-ossp extension is installed
SELECT
    'uuid-ossp extension' as check_type,
    extname,
    extversion
FROM pg_extension
WHERE extname = 'uuid-ossp';

-- Expected: One row with extname='uuid-ossp'

-- ============================================================================

-- Count tables
SELECT
    'table count' as check_type,
    COUNT(*) as count
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE';

-- Expected: At least 12 tables (users, devices, events, timelines, etc.)

-- ============================================================================

-- Check for is_verified column specifically
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'users'
            AND column_name = 'is_verified'
        )
        THEN 'PASS: is_verified column exists'
        ELSE 'FAIL: is_verified column MISSING - Run: ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT false;'
    END as verification_result;

-- ============================================================================
