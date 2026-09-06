const { pool } = require("./db");
async function addColumns() {
  try {
    console.log("🔄 Adding new columns to shifts table...");
    await pool.query(`
      ALTER TABLE shifts 
      ADD COLUMN IF NOT EXISTS actual_cash_counted NUMERIC DEFAULT 0
    `);
    console.log("✅ Added actual_cash_counted column");
    await pool.query(`
      ALTER TABLE shifts 
      ADD COLUMN IF NOT EXISTS final_shift_note TEXT DEFAULT ""
    `);
    console.log("✅ Added final_shift_note column");
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = "shifts" 
      AND column_name IN ("actual_cash_counted", "final_shift_note")
    `);
    console.log("📊 Columns added successfully:");
    console.table(result.rows);
    await pool.end();
    console.log("✅ Done!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error adding columns:", error.message);
    await pool.end();
    process.exit(1);
  }
}
addColumns();
