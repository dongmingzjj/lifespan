import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger } from './utils/logger.js';
import { createDatabase, getDatabase } from './utils/database.js';
import { defaultRateLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import syncRoutes from './routes/sync.js';
import healthRoutes from './routes/health.js';
import analysisRoutes from './routes/analysis.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// ============================================================================
// Middleware
// ============================================================================

// Trust proxy (for X-Forwarded-For header)
app.set('trust proxy', 1);

// Enhanced security headers with CSP
// CSP connect-src: Allow connections from CORS origins
const cspConnectOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      // Allow connections from configured CORS origins
      connectSrc: ["'self'", ...cspConnectOrigins],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS - Support multiple origins with credentials
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours for preflight cache
}));

// Log CORS configuration on startup
logger.info({
  allowedOrigins,
  credentials: true,
}, 'CORS configuration loaded');

// Compression
app.use(compression());

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging with performance tracking
app.use((req, res, next) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  (req as any).requestId = requestId;

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }, 'HTTP request');

    // Warn about slow requests (> 1s)
    if (duration > 1000) {
      logger.warn({
        requestId,
        method: req.method,
        path: req.path,
        duration,
      }, 'Slow request detected');
    }
  });

  next();
});

// ============================================================================
// Routes
// ============================================================================

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API routes
const apiRouter = express.Router();

// Apply default rate limiting to all API routes
apiRouter.use(defaultRateLimiter);

// Mount route modules
apiRouter.use('/auth', authRoutes);
apiRouter.use('/sync', syncRoutes);
apiRouter.use('/health', healthRoutes);
apiRouter.use('/analysis', analysisRoutes);

// API version prefix
app.use(`/api/${API_VERSION}`, apiRouter);

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler (must be before error handler)
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    // Initialize database connection
    // Try individual environment variables first (more reliable)
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
    const dbName = process.env.DB_NAME || 'lifespan';
    const dbUser = process.env.DB_USER || 'lifespan';
    const dbPassword = process.env.DB_PASSWORD;

    if (dbPassword) {
      // Use individual environment variables
      createDatabase({
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
      });

      logger.info({
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
      }, 'Database connection initialized (using individual env vars)');
    } else {
      // Fallback to DATABASE_URL
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('Neither DB_PASSWORD nor DATABASE_URL environment variable is set');
      }

      // Parse DATABASE_URL
      const match = databaseUrl.match(
        /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/
      );

      if (!match) {
        throw new Error('Invalid DATABASE_URL format');
      }

      const [, user, password, host, port, database] = match;

      createDatabase({
        user,
        password,
        host,
        port: parseInt(port, 10),
        database,
      });

      logger.info('Database connection initialized (using DATABASE_URL)');
    }

    // Test database connection
    const db = getDatabase();
    await db.query('SELECT 1');
    logger.info('Database connection verified');

    // Start server
    app.listen(PORT, () => {
      logger.info({
        port: PORT,
        version: API_VERSION,
        environment: process.env.NODE_ENV || 'development',
      }, 'Server started');
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');

  const { closeDatabase } = await import('./utils/database.js');
  await closeDatabase();

  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');

  const { closeDatabase } = await import('./utils/database.js');
  await closeDatabase();

  process.exit(0);
});

// Start the server
startServer();

export default app;
