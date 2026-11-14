import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { env } from './env.js';

export function openDb(filename) {
  fs.mkdirSync(env.dataDir, { recursive: true });
  const db = new Database(path.join(env.dataDir, filename));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  return db;
}

export function withSpan(name, attributes, fn) {
  return trace.getTracer('football').startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function dbAll(db, sql, params = []) {
  return withSpan('sqlite.query', { 'db.statement': sql.slice(0, 180) }, () => db.prepare(sql).all(...params));
}

export function dbGet(db, sql, params = []) {
  return withSpan('sqlite.query', { 'db.statement': sql.slice(0, 180) }, () => db.prepare(sql).get(...params));
}

export function dbRun(db, sql, params = []) {
  return withSpan('sqlite.query', { 'db.statement': sql.slice(0, 180) }, () => db.prepare(sql).run(...params));
}

function addColumn(db, table, name, type) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === name);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

export function migrateTeams(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stadiums (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL UNIQUE,
      city TEXT, country TEXT, capacity INTEGER,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL UNIQUE,
      country TEXT, founded INTEGER,
      stadium_id INTEGER REFERENCES stadiums(id),
      source TEXT NOT NULL,
      external_id TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      position TEXT, nationality TEXT, birth TEXT,
      source TEXT NOT NULL,
      UNIQUE(team_id, name_norm)
    );
    CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
    CREATE INDEX IF NOT EXISTS idx_teams_country ON teams(country);
    CREATE VIRTUAL TABLE IF NOT EXISTS teams_fts USING fts5(name, country, content='teams', content_rowid='id');
    CREATE VIRTUAL TABLE IF NOT EXISTS players_fts USING fts5(name, nationality, position, content='players', content_rowid='id');
    CREATE VIRTUAL TABLE IF NOT EXISTS stadiums_fts USING fts5(name, city, country, content='stadiums', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS teams_ai AFTER INSERT ON teams BEGIN
      INSERT INTO teams_fts(rowid, name, country) VALUES (new.id, new.name, coalesce(new.country,''));
    END;
    CREATE TRIGGER IF NOT EXISTS teams_ad AFTER DELETE ON teams BEGIN
      INSERT INTO teams_fts(teams_fts, rowid, name, country) VALUES ('delete', old.id, old.name, coalesce(old.country,''));
    END;
    CREATE TRIGGER IF NOT EXISTS teams_au AFTER UPDATE ON teams BEGIN
      INSERT INTO teams_fts(teams_fts, rowid, name, country) VALUES ('delete', old.id, old.name, coalesce(old.country,''));
      INSERT INTO teams_fts(rowid, name, country) VALUES (new.id, new.name, coalesce(new.country,''));
    END;
    CREATE TRIGGER IF NOT EXISTS players_ai AFTER INSERT ON players BEGIN
      INSERT INTO players_fts(rowid, name, nationality, position) VALUES (new.id, new.name, coalesce(new.nationality,''), coalesce(new.position,''));
    END;
    CREATE TRIGGER IF NOT EXISTS players_ad AFTER DELETE ON players BEGIN
      INSERT INTO players_fts(players_fts, rowid, name, nationality, position) VALUES ('delete', old.id, old.name, coalesce(old.nationality,''), coalesce(old.position,''));
    END;
    CREATE TRIGGER IF NOT EXISTS players_au AFTER UPDATE ON players BEGIN
      INSERT INTO players_fts(players_fts, rowid, name, nationality, position) VALUES ('delete', old.id, old.name, coalesce(old.nationality,''), coalesce(old.position,''));
      INSERT INTO players_fts(rowid, name, nationality, position) VALUES (new.id, new.name, coalesce(new.nationality,''), coalesce(new.position,''));
    END;
    CREATE TRIGGER IF NOT EXISTS stadiums_ai AFTER INSERT ON stadiums BEGIN
      INSERT INTO stadiums_fts(rowid, name, city, country) VALUES (new.id, new.name, coalesce(new.city,''), coalesce(new.country,''));
    END;
    CREATE TRIGGER IF NOT EXISTS stadiums_ad AFTER DELETE ON stadiums BEGIN
      INSERT INTO stadiums_fts(stadiums_fts, rowid, name, city, country) VALUES ('delete', old.id, old.name, coalesce(old.city,''), coalesce(old.country,''));
    END;
    CREATE TRIGGER IF NOT EXISTS stadiums_au AFTER UPDATE ON stadiums BEGIN
      INSERT INTO stadiums_fts(stadiums_fts, rowid, name, city, country) VALUES ('delete', old.id, old.name, coalesce(old.city,''), coalesce(old.country,''));
      INSERT INTO stadiums_fts(rowid, name, city, country) VALUES (new.id, new.name, coalesce(new.city,''), coalesce(new.country,''));
    END;
  `);
  addColumn(db, 'teams', 'badge_url', 'TEXT');
  addColumn(db, 'teams', 'youtube', 'TEXT');
}

export function migrateMatches(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      country TEXT,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY,
      league_id INTEGER NOT NULL REFERENCES leagues(id),
      year INTEGER NOT NULL,
      label TEXT,
      UNIQUE(league_id, year)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id),
      utc_date TEXT NOT NULL,
      status TEXT NOT NULL,
      home_team_id INTEGER NOT NULL,
      away_team_id INTEGER NOT NULL,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      home_goals INTEGER,
      away_goals INTEGER,
      odds_home REAL, odds_draw REAL, odds_away REAL,
      source TEXT NOT NULL,
      natural_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_matches_filter ON matches(utc_date, status, home_goals);
    CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
    CREATE INDEX IF NOT EXISTS idx_matches_home ON matches(home_team_id);
    CREATE INDEX IF NOT EXISTS idx_matches_away ON matches(away_team_id);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      match_id INTEGER NOT NULL REFERENCES matches(id),
      minute INTEGER,
      type TEXT NOT NULL,
      team_id INTEGER,
      player_name TEXT NOT NULL DEFAULT '',
      detail TEXT,
      source TEXT NOT NULL,
      UNIQUE(match_id, type, minute, player_name)
    );
    CREATE INDEX IF NOT EXISTS idx_events_match ON events(match_id);
  `);
  addColumn(db, 'matches', 'referee', 'TEXT');
  addColumn(db, 'matches', 'venue', 'TEXT');
  addColumn(db, 'matches', 'ht_home', 'INTEGER');
  addColumn(db, 'matches', 'ht_away', 'INTEGER');
  addColumn(db, 'matches', 'home_shots', 'INTEGER');
  addColumn(db, 'matches', 'away_shots', 'INTEGER');
  addColumn(db, 'matches', 'home_shots_on', 'INTEGER');
  addColumn(db, 'matches', 'away_shots_on', 'INTEGER');
  addColumn(db, 'matches', 'home_fouls', 'INTEGER');
  addColumn(db, 'matches', 'away_fouls', 'INTEGER');
  addColumn(db, 'matches', 'home_corners', 'INTEGER');
  addColumn(db, 'matches', 'away_corners', 'INTEGER');
  addColumn(db, 'matches', 'home_yellow', 'INTEGER');
  addColumn(db, 'matches', 'away_yellow', 'INTEGER');
  addColumn(db, 'matches', 'home_red', 'INTEGER');
  addColumn(db, 'matches', 'away_red', 'INTEGER');
}

export function migrateUsers(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      match_id INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      match_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_match ON comments(match_id);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      match_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS idx_notes_match ON notes(match_id);
  `);
}

export const encodeCursor = (n) => Buffer.from(String(n)).toString('base64url');
export const decodeCursor = (c) => (c ? Number(Buffer.from(String(c), 'base64url').toString()) || 0 : 0);

export function ftsQuery(q) {
  const tokens = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return '';
  return tokens.map((t) => `"${t.replaceAll('"', '')}"*`).join(' ');
}
