const { Pool } = require('pg');
require('dotenv').config();

// ============================================
// DATABASE CONFIGURATION
// ============================================

const DATABASE_URL = process.env.DATABASE_URL;

console.log('==========================================');
console.log('🔍 Checking environment variables...');
console.log('🔍 DATABASE_URL:', DATABASE_URL ? '✅ SET' : '❌ NOT SET');
console.log('🔍 NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('==========================================');

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is missing from environment!');
  console.error('📝 Please set DATABASE_URL in Railway variables');
  console.error('📝 Current variables:', Object.keys(process.env).filter(k => k.includes('DATABASE')));
}

const isProduction = process.env.NODE_ENV === 'production';

// Determine SSL configuration
let sslConfig = false;

if (DATABASE_URL) {
  // Check if URL already has sslMode parameter
  if (DATABASE_URL.includes('sslMode=require') || DATABASE_URL.includes('sslmode=require')) {
    console.log('🔒 SSL mode detected in URL');
    sslConfig = {
      rejectUnauthorized: false,
      require: true,
    };
  } else if (isProduction) {
    console.log('🔒 SSL enabled for production');
    sslConfig = {
      rejectUnauthorized: false,
      require: true,
    };
  }
}

// Create pool with SSL settings for Railway
const pool = new Pool({
  connectionString: DATABASE_URL || 'postgresql://localhost:5432/saraya_inventory',
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// ============================================
// DATABASE CONNECTION TEST WITH RETRY
// ============================================

const testDatabaseConnection = async () => {
  try {
    console.log('🔄 Testing database connection...');
    const result = await pool.query('SELECT NOW() AS current_time, version() AS version');
    console.log('==========================================');
    console.log('✅ PostgreSQL connected successfully!');
    console.log(`🕐 Database time: ${result.rows[0].current_time}`);
    console.log(`📦 PostgreSQL version: ${result.rows[0].version}`);
    console.log('==========================================');
    return true;
  } catch (error) {
    console.error('==========================================');
    console.error('❌ PostgreSQL connection failed');
    console.error('==========================================');
    console.error('Message:', error.message);
    console.error('Code:', error.code || 'No code');
    
    // Specific error messages
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Connection refused. Make sure PostgreSQL is running.');
      console.error('💡 Check if DATABASE_URL is correct.');
    }
    if (error.code === '28P01') {
      console.error('💡 Authentication failed. Check username and password.');
    }
    if (error.message && error.message.includes('timeout')) {
      console.error('💡 Connection timeout. Check network connectivity.');
    }
    console.error('==========================================');
    return false;
  }
};

// Test connection with retry
let retryCount = 0;
const maxRetries = 3;

const connectWithRetry = async () => {
  const connected = await testDatabaseConnection();
  if (!connected && retryCount < maxRetries) {
    retryCount++;
    console.log(`🔄 Retrying connection (${retryCount}/${maxRetries})...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await connectWithRetry();
  } else if (!connected) {
    console.error('❌ Failed to connect after', maxRetries, 'attempts');
    console.error('💡 Please check your DATABASE_URL and network settings');
  }
};

// Start connection test
connectWithRetry();

// ============================================
// SIMPLE QUERY HELPER
// ============================================

const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🗄️ SQL query executed in ${duration}ms`);
    }
    return result;
  } catch (error) {
    console.error('❌ SQL query failed');
    console.error('Query:', text);
    console.error('Error:', error.message);
    throw error;
  }
};

// ============================================
// TRANSACTION HELPER
// ============================================

const transaction = async callback => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// GRACEFUL DATABASE SHUTDOWN
// ============================================

const closeDatabase = async () => {
  try {
    await pool.end();
    console.log('✅ PostgreSQL pool closed');
  } catch (error) {
    console.error('❌ Error closing PostgreSQL:', error.message);
  }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
  pool,
  query,
  transaction,
  closeDatabase,
  testDatabaseConnection
};