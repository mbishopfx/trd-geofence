const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { dspConfig } = require("./config");

let pool;
let migrationsReady = false;

function hasDatabase() {
  return Boolean(dspConfig.databaseUrl);
}

function getPool() {
  if (!hasDatabase()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: dspConfig.databaseUrl,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    });
  }

  return pool;
}

async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return activePool.query(text, params);
}

async function withTransaction(callback) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  if (!hasDatabase() || migrationsReady) {
    return;
  }

  const migrationDir = path.resolve(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const activePool = getPool();
  const client = await activePool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1 LIMIT 1",
        [file]
      );
      if (existing.rowCount > 0) {
        continue;
      }

      const fullPath = path.join(migrationDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    migrationsReady = true;
  } finally {
    client.release();
  }
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    migrationsReady = false;
  }
}

module.exports = {
  hasDatabase,
  getPool,
  query,
  withTransaction,
  runMigrations,
  closeDatabase
};
