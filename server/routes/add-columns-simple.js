const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:0000@localhost:5432/saraya_inventory'
});

async function addColumns() {
  try {
    console.log('🔄 Adding new columns...');
    
    await pool.query(`
      ALTER TABLE shifts 
      ADD COLUMN IF NOT EXISTS actual_cash_counted NUMERIC DEFAULT 0
    `);
    console.log('✅ Added actual_cash_counted');
    
    await pool.query(`
      ALTER TABLE shifts 
      ADD COLUMN IF NOT EXISTS final_shift_note TEXT DEFAULT ''
    `);
    console.log('✅ Added final_shift_note');
    
    console.log('✅ All columns added successfully!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

addColumns();