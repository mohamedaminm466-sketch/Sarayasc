const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:0000@localhost:5432/saraya_inventory'
});
async function addFinalizedColumn() {
  const queries = [
    'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN DEFAULT false'
  ];
  try {
    console.log('🔄 Adding is_finalized column...');
    for (const query of queries) {
      await pool.query(query);
      console.log('✅ Executed: ' + query);
    }
    console.log('✅ is_finalized column added successfully!');
  } catch (err) {
    console.error('❌ Error adding column:', err);
  } finally {
    await pool.end();
  }
}
addFinalizedColumn();
