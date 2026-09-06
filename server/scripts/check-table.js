const { pool } = require('../db');

async function checkTable() {
  try {
    console.log('🔍 Checking if stock_discrepancies table exists...');
    
    // Check if table exists
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'stock_discrepancies'
      );
    `);
    
    if (result.rows[0].exists) {
      console.log('✅ stock_discrepancies table EXISTS!');
      
      // Count rows
      const count = await pool.query('SELECT COUNT(*) FROM stock_discrepancies');
      console.log(`📊 Table has ${count.rows[0].count} rows`);
      
      // Show table structure
      const columns = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'stock_discrepancies'
        ORDER BY ordinal_position;
      `);
      
      console.log('📋 Table columns:');
      columns.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
      
    } else {
      console.log('❌ stock_discrepancies table does NOT exist!');
      console.log('Please run: node server/scripts/create-discrepancy-table.js');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkTable();