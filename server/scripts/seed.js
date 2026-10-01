'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const auth = require('../src/auth');

const dir = path.join(__dirname, '..', 'seed-data');

function rows(name) {
  return fs.readFileSync(path.join(dir, name), 'utf8').trim().split(/\n/).flatMap((line) => {
    const value = JSON.parse(line);
    return Array.isArray(value) ? value : [value];
  });
}

async function upsert(client, table, items) {
  if (!items.length) return;
  const cols = Object.keys(items[0]);
  const set = cols.filter((col) => col !== 'id').map((col) => col + ' = EXCLUDED.' + col).join(', ');
  const sql = 'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' +
    cols.map((_, index) => '$' + (index + 1)).join(', ') + ') ON CONFLICT (id) DO UPDATE SET ' + set;
  for (const item of items) await client.query(sql, cols.map((col) => item[col]));
  await client.query("SELECT setval(pg_get_serial_sequence('" + table + "', 'id'), (SELECT MAX(id) FROM " + table + "))");
}

async function verify() {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM players) AS players,
      (SELECT COUNT(*)::int FROM clubs) AS clubs,
      (SELECT COUNT(*)::int FROM reports) AS reports,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM reports WHERE document_path IS NOT NULL) AS with_document,
      (SELECT COUNT(*)::int FROM players p WHERE NOT EXISTS (
        SELECT 1 FROM current_season_stats s WHERE s.player_id = p.id)) AS missing_current,
      (SELECT COUNT(*)::int FROM players p WHERE (
        SELECT COUNT(*) FROM all_time_stats s WHERE s.player_id = p.id) < 2) AS short_history`);
  const summary = rows[0];
  process.stdout.write(JSON.stringify(summary) + '\n');
  if (summary.players < 100 || summary.clubs < 22 || summary.reports < 25 || summary.users < 3 || summary.missing_current || summary.short_history) {
    throw new Error('Сид не проходит проверку');
  }
}

async function main() {
  if (process.argv.includes('--verify')) {
    await verify();
    return;
  }
  const players = rows('players.jsonl').map((row) => ({ ...row, bio: row.surname + ' ' + row.name + ', ' + row.position }));
  const reports = rows('reports.jsonl');
  const sample = path.join(dir, 'sample.pdf');
  const sampleSize = fs.statSync(sample).size;
  fs.mkdirSync(db.config.uploadDir, { recursive: true });
  for (const report of reports) {
    if (!report.document_path) continue;
    fs.copyFileSync(sample, path.join(db.config.uploadDir, report.document_path));
    report.document_size_bytes = sampleSize;
  }
  await db.tx(async (client) => {
    if (process.argv.includes('--truncate')) {
      await client.query('TRUNCATE password_resets, sessions, reports, all_time_stats, current_season_stats, players, seasons, clubs, nations, users RESTART IDENTITY CASCADE');
    }
    await upsert(client, 'nations', rows('nations.jsonl'));
    await upsert(client, 'clubs', rows('clubs.jsonl'));
    await upsert(client, 'seasons', rows('seasons.jsonl'));
    await upsert(client, 'players', players);
    await upsert(client, 'current_season_stats', rows('current.jsonl'));
    await upsert(client, 'all_time_stats', rows('history.jsonl'));
    await upsert(client, 'reports', reports);
    for (const [email, password, role] of [
      ['viewer@local.test', 'viewer', 'viewer'],
      ['scout@local.test', 'scout', 'scout'],
      ['admin@local.test', 'admin', 'admin']
    ]) {
      await client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
           failed_login_count = 0, locked_until = NULL`,
        [email, auth.hashPassword(password), role]
      );
    }
  });
  await verify();
}

main()
  .catch((error) => {
    process.stderr.write('[seed] ' + error.message + '\n');
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
