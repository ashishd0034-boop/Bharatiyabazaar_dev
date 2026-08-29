const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("pg");
const dotenv = require("dotenv");

// Load test environment configuration
const envTestPath = path.resolve(__dirname, "../.env.test");
const envConfig = dotenv.config({ path: envTestPath }).parsed || {};
const testDbUrl = envConfig.DATABASE_URL || process.env.DATABASE_URL;

if (!testDbUrl) {
  console.error("❌ ERROR: DATABASE_URL not found in .env.test");
  process.exit(1);
}

async function prepareTestDb() {
  const urlObj = new URL(testDbUrl.replace("postgresql://", "http://"));
  const dbName = urlObj.pathname.replace(/^\//, "");
  const username = urlObj.username || "postgres";
  const password = urlObj.password || "";
  const host = urlObj.hostname || "localhost";
  const port = urlObj.port || "5432";

  const adminConnString = `postgresql://${username}:${password}@${host}:${port}/postgres`;
  const adminClient = new Client({ connectionString: adminConnString });

  try {
    await adminClient.connect();
    const checkRes = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (checkRes.rowCount === 0) {
      console.log(`Creating test database "${dbName}"...`);
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✓ Test database "${dbName}" created.`);
    }
  } catch (err) {
    console.error("Warning when checking/creating database:", err.message);
  } finally {
    await adminClient.end();
  }

  // Generate and apply current schema.prisma DDL to the test database
  console.log(`Syncing schema with test database "${dbName}"...`);
  const schemaSql = execSync(
    "npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script",
    { encoding: "utf-8" }
  );

  const testDbClient = new Client({ connectionString: testDbUrl });
  try {
    await testDbClient.connect();
    await testDbClient.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await testDbClient.query(schemaSql);
    console.log(`✓ Test database "${dbName}" schema synchronized successfully.`);

    // Apply ledger integrity triggers to test DB
    const fs = require("fs");
    const triggerSqlPath = path.resolve(__dirname, "../prisma/migrations/20260829104500_ledger_integrity/migration.sql");
    const triggerSql = fs.readFileSync(triggerSqlPath, "utf-8");
    await testDbClient.query(triggerSql);
    console.log(`✓ Test database "${dbName}" ledger integrity triggers applied successfully.`);
  } catch (err) {
    console.error("❌ Failed to apply schema/triggers to test database:", err.message);
    process.exit(1);
  } finally {
    await testDbClient.end();
  }
}

prepareTestDb().catch((err) => {
  console.error(err);
  process.exit(1);
});
