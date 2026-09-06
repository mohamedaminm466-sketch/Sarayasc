const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:0000@localhost:5432/saraya_inventory'
});

async function addItemColumns() {
  const queries = [
    'ALTER TABLE items ADD COLUMN IF NOT EXISTS can_be_front BOOLEAN DEFAULT true',
    'ALTER TABLE items ADD COLUMN IF NOT EXISTS can_be_warehouse BOOLEAN DEFAULT true'
  ];

  try {
    console.log('🔄 Adding item columns...');
    for (const query of queries) {
      await pool.query(query);
      console.log('✅ Executed: ' + query);
    }
    console.log('✅ Item columns added successfully!');
  } catch (err) {
    console.error('❌ Error adding columns:', err);
  } finally {
    await pool.end();
  }
}

addItemColumns();