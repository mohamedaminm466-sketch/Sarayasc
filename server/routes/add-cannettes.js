const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:0000@localhost:5432/saraya_inventory'
});

async function addCannettesColumns() {
  const queries = [
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cannettes_sold INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cannettes_consumed NUMERIC(10,2) DEFAULT 0'
  ];

  try {
    console.log('🔄 Adding cannettes columns...');
    for (const query of queries) {
      await pool.query(query);
      console.log('✅ Executed: ' + query);
    }
    console.log('✅ Cannettes columns added successfully!');
  } catch (err) {
    console.error('❌ Error adding columns:', err);
  } finally {
    await pool.end();
  }
}

addCannettesColumns();