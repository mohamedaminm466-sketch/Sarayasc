const { Pool } = require('pg');

// Use the exact DATABASE_URL from Railway
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:HvauEWwMPEVnjivTfmphnsafApdhvYP@postgres.railway.internal:5432/railway';

console.log('🔍 Testing connection...');
console.log('🔍 DATABASE_URL exists:', !!process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    require: true,
  },
  connectionTimeoutMillis: 10000,
});

async function testConnection() {
  try {
    console.log('🔄 Connecting to PostgreSQL...');
    const result = await pool.query('SELECT NOW() as current_time, version() as version');
    console.log('✅ Connected successfully!');
    console.log('🕐 Database time:', result.rows[0].current_time);
    console.log('📦 PostgreSQL version:', result.rows[0].version);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('Error code:', err.code);
  } finally {
    await pool.end();
  }
}

testConnection();