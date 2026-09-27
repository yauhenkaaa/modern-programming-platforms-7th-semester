'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, types } = require('pg');

types.setTypeParser(1082, (value) => value);
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

const problems = [];

function readString(name) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  return raw.trim();
}

function readInt(name, fallback, min, max) {
  const raw = readString(name);
  if (raw === null) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    problems.push(name + ' должен быть целым числом');
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) problems.push(name + ' вне диапазона ' + min + '..' + max);
  return value;
}

function databaseConfig() {
  const connectionString = readString('DATABASE_URL');
  if (connectionString) return { connectionString };
  const host = readString('PGHOST');
  const user = readString('PGUSER');
  const password = readString('PGPASSWORD');
  const database = readString('PGDATABASE');
  const port = readInt('PGPORT', 5432, 1, 65535);
  if (!host || !user || !password || !database) {
    problems.push('Укажите DATABASE_URL или PGHOST, PGUSER, PGPASSWORD и PGDATABASE');
    return null;
  }
  return { host, port, user, password, database };
}

const database = databaseConfig();
const config = {
  port: readInt('PORT', 3001, 1, 65535),
  origin: readString('CLIENT_ORIGIN') || 'http://localhost:5173',
  uploadDir: path.resolve(root, readString('UPLOAD_DIR') || './uploads'),
  maxUploadMb: readInt('MAX_UPLOAD_MB', 10, 1, 100),
  isProduction: (readString('NODE_ENV') || 'development') === 'production',
  slowMs: readInt('DB_SLOW_QUERY_MS', 200, 1, 60000),
  database
};
config.maxUploadBytes = config.maxUploadMb * 1024 * 1024;

if (problems.length) {
  process.stderr.write('Некорректная конфигурация:\n' + problems.map((item) => '  - ' + item + '\n').join(''));
  process.exit(1);
}

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || [];
  }
}

function http(status, code, message, details) {
  return new HttpError(status, code, message, details);
}

const pool = new Pool({
  ...database,
  max: readInt('PG_POOL_MAX', 10, 1, 100),
  connectionTimeoutMillis: readInt('DB_CONNECTION_TIMEOUT_MS', 5000, 100, 60000),
  idleTimeoutMillis: readInt('DB_IDLE_TIMEOUT_MS', 10000, 0, 600000)
});

async function query(text, params) {
  const started = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - started;
  if (ms >= config.slowMs) process.stderr.write('[sql] ' + ms + 'ms ' + text.replace(/\s+/g, ' ').slice(0, 160) + '\n');
  return result;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

async function migrate(argv) {
  const fresh = argv.includes('--fresh');
  const force = argv.includes('--force');
  if (fresh && config.isProduction && !force) {
    throw new Error('--fresh в production требует --force');
  }
  if (fresh) {
    await query('DROP SCHEMA IF EXISTS public CASCADE');
    await query('CREATE SCHEMA public');
  }
  await query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const applied = await query('SELECT checksum FROM schema_migrations WHERE name = $1', ['schema.sql']);
  if (applied.rowCount) {
    if (applied.rows[0].checksum !== checksum) {
      throw new Error('schema.sql изменён после применения. Для локальной базы: npm run migrate -- --fresh');
    }
    process.stdout.write('[migrate] схема актуальна\n');
    return;
  }
  await tx(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', ['schema.sql', checksum]);
  });
  process.stdout.write('[migrate] схема применена\n');
}

if (require.main === module) {
  migrate(process.argv.slice(2))
    .catch((error) => {
      process.stderr.write('[migrate] ' + error.message + '\n');
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { config, query, tx, pool, http, HttpError };
