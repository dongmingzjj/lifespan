import type { PoolConfig, QueryResult } from 'pg';
import { Pool } from 'pg';
import { logger } from './logger.js';

let pool: Pool | null = null;

// Performance metrics
let totalQueries = 0;
let slowQueries = 0;
const queryDurations: number[] = [];

export interface DatabaseConfig {
  host?: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export function createDatabase(config: DatabaseConfig): Pool {
  if (pool) {
    return pool;
  }

  const poolConfig: PoolConfig = {
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.max || 20,
    idleTimeoutMillis: config.idleTimeoutMs || 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs || 2000,
  };

  pool = new Pool(poolConfig);

  // Enhanced pool monitoring
  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
  });

  pool.on('connect', () => {
    logger.debug('New database client connected');
  });

  pool.on('remove', () => {
    logger.debug('Database client removed');
  });

  return pool;
}

export function getDatabase(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // Parse DATABASE_URL: postgresql://user:password@host:port/database
    const match = databaseUrl.match(
      /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/
    );

    if (!match) {
      throw new Error('Invalid DATABASE_URL format');
    }

    const [, user, password, host, port, database] = match;

    pool = createDatabase({
      user,
      password,
      host,
      port: parseInt(port, 10),
      database,
    });
  }

  return pool;
}

export async function query(
  text: string,
  params?: any[]
): Promise<QueryResult> {
  const start = Date.now();
  const db = getDatabase();

  try {
    const result = await db.query(text, params);
    const duration = Date.now() - start;

    // Track metrics
    totalQueries++;
    queryDurations.push(duration);

    // Keep only last 100 query durations
    if (queryDurations.length > 100) {
      queryDurations.shift();
    }

    // Log slow queries (> 1s)
    if (duration > 1000) {
      slowQueries++;
      logger.warn({
        sql: text.substring(0, 100), // First 100 chars
        duration,
        params,
        rows: result.rowCount,
      }, 'Slow query detected');
    } else {
      logger.debug({
        sql: text,
        params,
        duration,
        rows: result.rowCount,
      }, 'Database query executed');
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;

    logger.error({
      err: error,
      sql: text.substring(0, 100),
      params,
      duration,
    }, 'Database query failed');

    throw error;
  }
}

export async function queryWithTimeout(
  text: string,
  params?: any[],
  timeout: number = 5000
): Promise<QueryResult> {
  return Promise.race([
    query(text, params),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeout)
    ),
  ]);
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const db = getDatabase();
    await db.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return false;
  }
}

/**
 * Get pool statistics
 */
export function getPoolStats() {
  if (!pool) {
    return { totalCount: 0, idleCount: 0, waitingCount: 0 };
  }

  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics() {
  const avgDuration = queryDurations.length > 0
    ? queryDurations.reduce((a, b) => a + b, 0) / queryDurations.length
    : 0;

  const maxDuration = queryDurations.length > 0
    ? Math.max(...queryDurations)
    : 0;

  const p95Duration = queryDurations.length > 0
    ? [...queryDurations].sort((a, b) => a - b)[Math.floor(queryDurations.length * 0.95)]
    : 0;

  return {
    totalQueries,
    slowQueries,
    avgDuration: Math.round(avgDuration),
    maxDuration: Math.round(maxDuration),
    p95Duration: Math.round(p95Duration),
  };
}

/**
 * Log periodic performance summary
 */
setInterval(() => {
  const stats = getPoolStats();
  const metrics = getPerformanceMetrics();

  logger.info({
    pool: stats,
    performance: metrics,
  }, 'Database performance metrics');

  // Reset counters periodically
  if (totalQueries > 100000) {
    totalQueries = 0;
    slowQueries = 0;
    queryDurations.length = 0;
  }
}, 300000); // Every 5 minutes

