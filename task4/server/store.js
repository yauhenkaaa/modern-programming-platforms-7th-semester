import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import pg from 'pg';

const scryptAsync = promisify(scrypt);

function loadEnv() {
  const file = new URL('../.env', import.meta.url);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/go';
const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined
});

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export async function migrate() {
  await pool.query(schema);
}

export async function closePool() {
  await pool.end();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at
  };
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)).toString('hex');
  return { salt, hash };
}

export async function verifyPassword(password, salt, expectedHex) {
  const actual = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function createUser({ id, username, passwordHash, salt }) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, username, password_hash, salt)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, created_at`,
    [id, username, passwordHash, salt]
  );
  return publicUser(rows[0]);
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query(
    `SELECT id, username, password_hash, salt, created_at
     FROM users WHERE lower(username) = lower($1)`,
    [username]
  );
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, username, created_at FROM users WHERE id = $1`,
    [id]
  );
  return publicUser(rows[0]);
}

export async function searchUsers(query, exceptId) {
  const safe = String(query).replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { rows } = await pool.query(
    `SELECT id, username, created_at
     FROM users
     WHERE id <> $1 AND lower(username) LIKE lower($2) ESCAPE '\\'
     ORDER BY username
     LIMIT 10`,
    [exceptId, `%${safe}%`]
  );
  return rows.map(publicUser);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [token, userId]);
  return token;
}

export async function getSession(token) {
  const { rows } = await pool.query(
    `SELECT s.token, u.id, u.username, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );
  if (!rows[0]) return null;
  return { token: rows[0].token, user: publicUser(rows[0]) };
}

export async function deleteSession(token) {
  await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export async function findFriendshipBetween(a, b) {
  const { rows } = await pool.query(
    `SELECT id, from_id, to_id, status, created_at
     FROM friendships
     WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)`,
    [a, b]
  );
  return rows;
}

export async function createFriendship({ id, fromId, toId }) {
  const { rows } = await pool.query(
    `INSERT INTO friendships (id, from_id, to_id, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id, from_id, to_id, status, created_at`,
    [id, fromId, toId]
  );
  return rows[0];
}

export async function listFriendships(userId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.from_id, f.to_id, f.status, f.created_at,
            u.id AS friend_id, u.username AS friend_username
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.from_id = $1 THEN f.to_id ELSE f.from_id END
     WHERE f.from_id = $1 OR f.to_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    status: row.status,
    createdAt: row.created_at,
    user: { id: row.friend_id, username: row.friend_username }
  }));
}

export async function getFriendship(id) {
  const { rows } = await pool.query(
    `SELECT id, from_id, to_id, status, created_at FROM friendships WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function setFriendshipStatus(id, status) {
  await pool.query(`UPDATE friendships SET status = $2 WHERE id = $1`, [id, status]);
}

export async function deleteFriendship(id) {
  await pool.query(`DELETE FROM friendships WHERE id = $1`, [id]);
}

function gameToRow(game) {
  return [
    game.id,
    game.size,
    game.komi,
    game.blackId,
    game.whiteId,
    JSON.stringify(game.moves),
    JSON.stringify(game.board),
    game.forbiddenHash,
    game.phase,
    game.rev,
    game.turn,
    game.consecutivePasses,
    JSON.stringify(game.prisoners),
    JSON.stringify(game.deadMarks),
    JSON.stringify(game.confirms),
    game.scoreBlack,
    game.scoreWhite,
    game.winner,
    game.reason,
    game.createdAt,
    game.finishedAt
  ];
}

export function rowToGame(row) {
  return {
    id: row.id,
    size: row.size,
    komi: Number(row.komi),
    blackId: row.black_id,
    whiteId: row.white_id,
    moves: row.moves,
    board: row.board,
    forbiddenHash: row.forbidden_hash,
    phase: row.phase,
    rev: row.rev,
    turn: row.turn,
    consecutivePasses: row.consecutive_passes,
    prisoners: row.prisoners,
    deadMarks: row.dead_marks,
    confirms: row.confirms,
    scoreBlack: row.score_black === null ? null : Number(row.score_black),
    scoreWhite: row.score_white === null ? null : Number(row.score_white),
    winner: row.winner,
    reason: row.reason,
    createdAt: row.created_at,
    finishedAt: row.finished_at
  };
}

const gameColumns = `
  id, size, komi, black_id, white_id, moves, board, forbidden_hash, phase, rev, turn,
  consecutive_passes, prisoners, dead_marks, confirms, score_black, score_white,
  winner, reason, created_at, finished_at
`;

export async function saveGame(game) {
  await pool.query(
    `INSERT INTO games (
      id, size, komi, black_id, white_id, moves, board, forbidden_hash, phase, rev, turn,
      consecutive_passes, prisoners, dead_marks, confirms, score_black, score_white,
      winner, reason, created_at, finished_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,
      $16,$17,$18,$19,$20,$21
    )
    ON CONFLICT (id) DO UPDATE SET
      moves = EXCLUDED.moves,
      board = EXCLUDED.board,
      forbidden_hash = EXCLUDED.forbidden_hash,
      phase = EXCLUDED.phase,
      rev = EXCLUDED.rev,
      turn = EXCLUDED.turn,
      consecutive_passes = EXCLUDED.consecutive_passes,
      prisoners = EXCLUDED.prisoners,
      dead_marks = EXCLUDED.dead_marks,
      confirms = EXCLUDED.confirms,
      score_black = EXCLUDED.score_black,
      score_white = EXCLUDED.score_white,
      winner = EXCLUDED.winner,
      reason = EXCLUDED.reason,
      finished_at = EXCLUDED.finished_at`,
    gameToRow(game)
  );
}

export async function getGame(id) {
  const { rows } = await pool.query(`SELECT ${gameColumns} FROM games WHERE id = $1`, [id]);
  return rows[0] ? rowToGame(rows[0]) : null;
}

export async function listUnfinished() {
  const { rows } = await pool.query(
    `SELECT ${gameColumns} FROM games WHERE phase <> 'finished' ORDER BY created_at`
  );
  return rows.map(rowToGame);
}

export async function listGamesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.size, g.phase, g.winner, g.reason, g.score_black, g.score_white,
            g.created_at, g.finished_at, g.black_id, g.white_id,
            bu.username AS black_name, wu.username AS white_name
     FROM games g
     JOIN users bu ON bu.id = g.black_id
     JOIN users wu ON wu.id = g.white_id
     WHERE g.black_id = $1 OR g.white_id = $1
     ORDER BY g.created_at DESC
     LIMIT 100`,
    [userId]
  );
  return rows.map((row) => {
    const you = row.black_id === userId ? 'black' : 'white';
    const opponent = you === 'black'
      ? { id: row.white_id, username: row.white_name }
      : { id: row.black_id, username: row.black_name };
    let result = 'unfinished';
    if (row.phase === 'finished') result = row.winner === you ? 'win' : 'loss';
    return {
      id: row.id,
      size: row.size,
      phase: row.phase,
      you,
      opponent,
      winner: row.winner,
      reason: row.reason,
      scoreBlack: row.score_black === null ? null : Number(row.score_black),
      scoreWhite: row.score_white === null ? null : Number(row.score_white),
      result,
      createdAt: row.created_at,
      finishedAt: row.finished_at
    };
  });
}

export async function statsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT black_id, winner FROM games
     WHERE phase = 'finished' AND (black_id = $1 OR white_id = $1)`,
    [userId]
  );
  const stats = {
    played: rows.length,
    wins: 0,
    losses: 0,
    winRate: 0,
    black: { played: 0, wins: 0 },
    white: { played: 0, wins: 0 }
  };
  for (const row of rows) {
    const you = row.black_id === userId ? 'black' : 'white';
    const won = row.winner === you;
    stats[you].played += 1;
    if (won) {
      stats.wins += 1;
      stats[you].wins += 1;
    } else {
      stats.losses += 1;
    }
  }
  stats.winRate = stats.played ? stats.wins / stats.played : 0;
  return stats;
}
