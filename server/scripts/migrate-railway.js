const { pool } = require('../db');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  try {
    console.log('🔄 Running database migrations on Railway...');
    console.log('📡 Connecting to:', process.env.DATABASE_URL ? '✅ DATABASE_URL set' : '❌ DATABASE_URL not set');
    
    // Test connection first
    try {
      const test = await pool.query('SELECT NOW()');
      console.log('✅ Connected to PostgreSQL!');
    } catch (err) {
      console.error('❌ Cannot connect to database:', err.message);
      console.log('💡 Make sure DATABASE_URL is set correctly');
      await pool.end();
      return;
    }
    
    // Read schema.sql
    const schemaPath = path.join(__dirname, '../../database/schema.sql');
    console.log('📄 Reading schema.sql from:', schemaPath);
    
    if (!fs.existsSync(schemaPath)) {
      console.error('❌ schema.sql not found at:', schemaPath);
      await pool.end();
      return;
    }
    
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
    
    // Clean the SQL - remove CREATE DATABASE and \c commands
    const cleanedSQL = schemaSQL
      .split('\n')
      .filter(line => !line.trim().toLowerCase().startsWith('create database'))
      .filter(line => !line.trim().startsWith('\\c'))
      .join('\n');
    
    // Split into individual statements
    const statements = cleanedSQL
      .split(';')
      .filter(stmt => stmt.trim().length > 0)
      .map(stmt => stmt.trim() + ';');
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    let executed = 0;
    let skipped = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await pool.query(stmt);
        executed++;
        if (i % 10 === 0) {
          console.log(`📊 Progress: ${i + 1}/${statements.length}`);
        }
      } catch (err) {
        // Ignore "already exists" errors
        if (err.message.includes('already exists') || 
            err.message.includes('duplicate key') ||
            err.message.includes('already defined') ||
            err.message.includes('relation') && err.message.includes('already exists')) {
          skipped++;
        } else {
          console.error(`❌ Error on statement ${i + 1}:`, err.message);
        }
      }
    }
    
    console.log('✅ Schema migration completed!');
    console.log(`📊 Executed: ${executed}, Skipped: ${skipped}`);
    
    // Now run the shift metrics migration
    console.log('🔄 Running shift metrics migration...');
    const migrationPath = path.join(__dirname, '../../database/migration_shift_metrics.sql');
    
    if (fs.existsSync(migrationPath)) {
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      const migrationStatements = migrationSQL
        .split(';')
        .filter(stmt => stmt.trim().length > 0)
        .map(stmt => stmt.trim() + ';');
      
      console.log(`📝 Found ${migrationStatements.length} migration statements`);
      
      let migExecuted = 0;
      let migSkipped = 0;
      
      for (let i = 0; i < migrationStatements.length; i++) {
        const stmt = migrationStatements[i];
        try {
          await pool.query(stmt);
          migExecuted++;
        } catch (err) {
          if (err.message.includes('already exists') || 
              err.message.includes('duplicate column') ||
              err.message.includes('already defined')) {
            migSkipped++;
          } else {
            console.error(`❌ Error on migration ${i + 1}:`, err.message);
          }
        }
      }
      
      console.log('✅ Shift metrics migration completed!');
      console.log(`📊 Executed: ${migExecuted}, Skipped: ${migSkipped}`);
    } else {
      console.log('⚠️ migration_shift_metrics.sql not found, skipping');
    }
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

runMigrations();