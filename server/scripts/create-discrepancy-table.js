const { pool } = require('../db');

async function createTable() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Creating stock_discrepancies table...');
    
    // Create the table
    await client.query(`
      DROP TABLE IF EXISTS stock_discrepancies CASCADE;
      
      CREATE TABLE stock_discrepancies (
          id SERIAL PRIMARY KEY,
          item_id INTEGER NOT NULL,
          reported_by INTEGER NOT NULL,
          expected_quantity DECIMAL(10,2) NOT NULL,
          actual_quantity DECIMAL(10,2) NOT NULL,
          notes TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMP,
          reviewed_by INTEGER
      );
    `);
    
    console.log('✅ Table created successfully');
    
    // Add foreign keys
    console.log('🔄 Adding foreign keys...');
    
    await client.query(`
      ALTER TABLE stock_discrepancies 
      ADD CONSTRAINT fk_stock_discrepancies_item 
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
    `);
    
    await client.query(`
      ALTER TABLE stock_discrepancies 
      ADD CONSTRAINT fk_stock_discrepancies_reported_by 
      FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE;
    `);
    
    await client.query(`
      ALTER TABLE stock_discrepancies 
      ADD CONSTRAINT fk_stock_discrepancies_reviewed_by 
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
    `);
    
    console.log('✅ Foreign keys added');
    
    // Add check constraint
    console.log('🔄 Adding check constraint...');
    
    await client.query(`
      ALTER TABLE stock_discrepancies 
      ADD CONSTRAINT chk_status 
      CHECK (status IN ('pending', 'reviewed', 'resolved'));
    `);
    
    console.log('✅ Check constraint added');
    
    // Create indexes
    console.log('🔄 Creating indexes...');
    
    await client.query(`
      CREATE INDEX idx_stock_discrepancies_status ON stock_discrepancies(status);
      CREATE INDEX idx_stock_discrepancies_item_id ON stock_discrepancies(item_id);
      CREATE INDEX idx_stock_discrepancies_reported_by ON stock_discrepancies(reported_by);
    `);
    
    console.log('✅ Indexes created');
    
    // Add locked_at column to shifts
    console.log('🔄 Adding locked_at to shifts...');
    
    await client.query(`
      ALTER TABLE shifts ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_shifts_locked_at ON shifts(locked_at);
      UPDATE shifts SET locked_at = end_time WHERE status = 'ended' AND end_time IS NOT NULL;
    `);
    
    console.log('✅ locked_at column added to shifts');
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createTable();