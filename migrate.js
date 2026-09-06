const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:0000@localhost:5432/saraya_inventory'
});
async function addColumns() {
  const queries = [
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_05_sold INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_1_sold INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_15_sold INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_bolar_sold INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS kamia INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_05_consumed NUMERIC(10,2) DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_1_consumed NUMERIC(10,2) DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_15_consumed NUMERIC(10,2) DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS water_bolar_consumed NUMERIC(10,2) DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS soda_sold INTEGER DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS soda_consumed NUMERIC(10,2) DEFAULT 0'
  ];
  try {
    console.log('🔄 Starting migration...');
    for (const query of queries) {
      await pool.query(query);
      console.log('✅ Executed: ' + query);
    }
    console.log('✅ All columns added successfully!');
  } catch (err) {
    console.error('❌ Error adding columns:', err);
  } finally {
    await pool.end();
  }
}
addColumns();
