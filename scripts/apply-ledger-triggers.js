const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

// Allow passing custom env path, e.g. .env.test
const envFile = process.env.DOTENV_CONFIG_PATH || ".env";
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ ERROR: DATABASE_URL not found in environment.");
  process.exit(1);
}

async function applyLedgerTriggers(targetUrl = dbUrl) {
  const client = new Client({ connectionString: targetUrl });
  try {
    await client.connect();
    console.log(`🔌 Connected to database to apply ledger integrity triggers...`);

    const sqlPath = path.resolve(__dirname, "../prisma/migrations/20260829104500_ledger_integrity/migration.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");

    await client.query(sql);
    console.log(`✓ Trigger DDL executed successfully.`);

    // Verify triggers exist
    const res = await client.query(`
      SELECT tgname, relname, tgtype
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      WHERE tgname IN ('wallet_ledger_guard', 'ledger_immutability_guard');
    `);

    console.log(`✓ Found ${res.rowCount} active ledger triggers in database:`);
    for (const row of res.rows) {
      console.log(`  - Trigger "${row.tgname}" on table "${row.relname}"`);
    }

    if (res.rowCount < 2) {
      throw new Error(`Expected 2 triggers, found ${res.rowCount}`);
    }

    return true;
  } catch (err) {
    console.error("❌ Failed to apply ledger integrity triggers:", err.message);
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyLedgerTriggers()
    .then(() => {
      console.log("🎉 Ledger integrity triggers are active and verified.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { applyLedgerTriggers };
