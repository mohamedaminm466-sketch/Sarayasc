const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ============================================
// IMPORT ROUTES
// ============================================

const authRoutes = require('./routes/auth');
const stockRoutes = require('./routes/stock');
const shiftRoutes = require('./routes/shifts');
const logRoutes = require('./routes/logs');
const { pool } = require('./db');

console.log('🚀 Starting Saraya server...');

const app = express();

// ============================================
// CONFIGURATION
// ============================================

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================
// HELPER: RUN SQL FILE
// ============================================

async function runSqlFile(filePath, migrationName) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ ${migrationName} file not found.`);
    console.log(`📁 Expected path: ${filePath}`);
    return;
  }

  console.log(`🔄 Checking ${migrationName}...`);

  try {
    const sql = fs.readFileSync(filePath, 'utf8');

    // Remove CREATE DATABASE commands and \c commands
    const cleanedSQL = sql
      .split('\n')
      .filter(
        line =>
          !line.trim().toLowerCase().startsWith('create database')
      )
      .filter(
        line =>
          !line.trim().startsWith('\\c')
      )
      .join('\n');

    const statements = cleanedSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    let executed = 0;
    let skipped = 0;

    for (const statement of statements) {
      try {
        await pool.query(statement + ';');
        executed++;
      } catch (err) {
        const message = (err.message || '').toLowerCase();

        // These errors usually mean the migration
        // was already applied before
        const safeToIgnore =
          message.includes('already exists') ||
          message.includes('duplicate column') ||
          message.includes('duplicate key') ||
          message.includes('already a member');

        if (safeToIgnore) {
          skipped++;
        } else {
          console.error(
            `❌ ${migrationName} error:`,
            err.message
          );

          // We continue with other statements
          // so one already-existing object does not
          // stop the entire startup.
        }
      }
    }

    console.log(
      `✅ ${migrationName} completed! ` +
      `(${executed} executed, ${skipped} already existed)`
    );

  } catch (error) {
    console.error(
      `❌ Failed to run ${migrationName}:`,
      error.message
    );
  }
}

// ============================================
// RUN MIGRATIONS ON STARTUP
// ============================================

async function runMigrationsOnStartup() {
  try {
    console.log('');
    console.log('==========================================');
    console.log('🔄 CHECKING DATABASE MIGRATIONS');
    console.log('==========================================');

    // ==========================================
    // CHECK IF USERS TABLE EXISTS
    // ==========================================

    const check = await pool.query(`
      SELECT EXISTS (
        SELECT
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);

    const usersTableExists = check.rows[0].exists;

    // ==========================================
    // 1. INITIAL DATABASE SCHEMA
    // ==========================================

    if (!usersTableExists) {
      console.log(
        '📦 Database not initialized. Running schema.sql...'
      );

      const schemaPath = path.join(
        __dirname,
        '../database/schema.sql'
      );

      await runSqlFile(
        schemaPath,
        'Database schema'
      );

    } else {
      console.log(
        '✅ Database already initialized.'
      );
    }

    // ==========================================
    // 2. SHIFT METRICS MIGRATION
    // IMPORTANT:
    // This runs independently from schema.sql
    // ==========================================

    const shiftMetricsPath = path.join(
      __dirname,
      '../database/migration_shift_metrics.sql'
    );

    await runSqlFile(
      shiftMetricsPath,
      'Shift metrics migration'
    );

    // ==========================================
    // 3. FINANCIAL SHIFT MIGRATION
    // NEW:
    //
    // Expenses
    // Manque
    // Staff salary
    // Financial adjustments
    // ==========================================

    const financialMigrationPath = path.join(
      __dirname,
      '../database/migration_financial_shift.sql'
    );

    await runSqlFile(
      financialMigrationPath,
      'Financial shift migration'
    );

    // ==========================================
    // 4. RECETTE ADJUSTMENTS MIGRATION
    // NEW:
    //
    // recette_adjustments JSONB column
    // Stores the adjustments workers make
    // ==========================================

    const recetteAdjustmentsPath = path.join(
      __dirname,
      '../database/migration_recette_adjustments.sql'
    );

    await runSqlFile(
      recetteAdjustmentsPath,
      'Recette adjustments migration'
    );

    // ==========================================
    // 5. FINANCIAL AUDIT MIGRATION
    // NEW:
    //
    // Financial audit tables and functions
    // ==========================================

    const financialAuditPath = path.join(
      __dirname,
      '../database/migration_shift_financial_audit.sql'
    );

    await runSqlFile(
      financialAuditPath,
      'Financial audit migration'
    );

    console.log('');
    console.log('==========================================');
    console.log('✅ DATABASE MIGRATION CHECK COMPLETE');
    console.log('==========================================');
    console.log('');

  } catch (err) {
    console.error('');
    console.error('==========================================');
    console.error('⚠️ MIGRATION CHECK FAILED');
    console.error('==========================================');
    console.error(err.message);
    console.error('');
    console.log(
      '💡 Continuing startup... Check the database if problems occur.'
    );
    console.log('');
  }
}

// ============================================
// RUN MIGRATIONS BEFORE STARTING SERVER
// ============================================

(async () => {
  await runMigrationsOnStartup();
  startServer();
})();

// ============================================
// START SERVER
// ============================================

function startServer() {

  // ============================================
  // SECURITY
  // ============================================

  app.use(
    helmet({
      crossOriginResourcePolicy: false
    })
  );

  // ============================================
  // CORS
  // ============================================

  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.FRONTEND_URL
  ].filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {

        // Allow:
        // - Requests without an origin
        // - Local development
        // - Production frontend URL

        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        console.log('❌ CORS blocked:', origin);

        return callback(
          new Error(
            `CORS blocked for origin: ${origin}`
          )
        );
      },

      credentials: true
    })
  );

  // ============================================
  // BODY PARSERS
  // ============================================

  app.use(
    express.json({
      limit: '10mb'
    })
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: '10mb'
    })
  );

  // ============================================
  // RATE LIMITING
  // ============================================

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    max: 100,

    standardHeaders: true,

    legacyHeaders: false,

    message: {
      error:
        'Too many requests, please try again later.'
    }
  });

  app.use('/api/', limiter);

  // ============================================
  // ROUTES
  // ============================================

  console.log('📡 Registering API routes...');

  // AUTH
  app.use('/api/auth', authRoutes);
  console.log('   ✅ /api/auth');

  // STOCK
  app.use('/api/stock', stockRoutes);
  console.log('   ✅ /api/stock');

  // SHIFTS
  app.use('/api/shifts', shiftRoutes);
  console.log('   ✅ /api/shifts');

  // LOGS
  app.use('/api/logs', logRoutes);
  console.log('   ✅ /api/logs');

  // ============================================
  // ROOT API
  // ============================================

  app.get('/api', (req, res) => {
    res.json({
      name: 'Saraya Inventory API',
      status: 'running',
      environment: NODE_ENV,
      timestamp: new Date().toISOString()
    });
  });

  // ============================================
  // HEALTH CHECK
  // ============================================

  app.get('/api/health', async (req, res) => {

    try {

      const result = await pool.query(
        'SELECT NOW()'
      );

      res.json({
        status: 'ok',

        database: 'connected',

        time: result.rows[0].now,

        environment: NODE_ENV,

        timestamp: new Date().toISOString()
      });

    } catch (error) {

      console.error(
        '❌ Health check database error:',
        error.message
      );

      res.status(503).json({

        status: 'error',

        database: 'disconnected',

        error: error.message,

        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================
  // 404 HANDLER
  // ============================================

  app.use((req, res) => {

    console.log(
      `❌ Route not found: ${req.method} ${req.originalUrl}`
    );

    res.status(404).json({

      error: 'Route not found',

      method: req.method,

      path: req.originalUrl
    });
  });

  // ============================================
  // GLOBAL ERROR HANDLER
  // ============================================

  app.use((err, req, res, next) => {

    console.error('❌ Server error:', err);

    res.status(err.status || 500).json({

      error: 'Something went wrong',

      message:
        NODE_ENV === 'development'
          ? err.message
          : undefined
    });
  });

  // ============================================
  // START SERVER
  // ============================================

  const server = app.listen(
    PORT,
    () => {

      console.log('');
      console.log('==========================================');
      console.log('🚀 SARAYA SERVER RUNNING');
      console.log('==========================================');

      console.log(`📡 Port: ${PORT}`);

      console.log(
        `🌍 Environment: ${NODE_ENV}`
      );

      console.log(
        `❤️  Health: http://localhost:${PORT}/api/health`
      );

      console.log(
        `📦 Stock: http://localhost:${PORT}/api/stock`
      );

      console.log(
        `🕐 Shifts: http://localhost:${PORT}/api/shifts`
      );

      console.log('==========================================');
      console.log('');
    }
  );

  // ============================================
  // GRACEFUL SHUTDOWN
  // ============================================

  let isShuttingDown = false;

  const shutdown = async signal => {

    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    console.log('');
    console.log(
      `🛑 ${signal} received. Shutting down...`
    );

    server.close(async error => {

      if (error) {

        console.error(
          '❌ Error closing server:',
          error.message
        );

        process.exit(1);
      }

      try {

        await pool.end();

        console.log(
          '✅ Database connection closed.'
        );

        console.log(
          '✅ Server stopped.'
        );

        process.exit(0);

      } catch (error) {

        console.error(
          '❌ Shutdown error:',
          error
        );

        process.exit(1);
      }
    });
  };

  process.on(
    'SIGINT',
    () => shutdown('SIGINT')
  );

  process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
  );
}