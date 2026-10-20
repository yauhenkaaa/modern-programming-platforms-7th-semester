import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  BLACK,
  KOMI,
  WHITE,
  applyMove,
  boardHash,
  emptyBoard,
  normalizeDead,
  opposite,
  samePoints,
  scoring
} from './rules.js';
import * as store from './store.js';

const PORT = Number(process.env.PORT) || 3000;
const DISCONNECT_MS = 60_000;
const SIZES = new Set([9, 13, 19]);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const rulesPath = path.join(rootDir, 'server', 'rules.js');

const games = new Map();
const names = new Map();
const sockets = new Map();
const queues = new Map([[9, []], [13, []], [19, []]]);
const invites = new Map();
const disconnectedAt = new Map();
const locks = new Map();

function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(() => fn());
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

function sendUser(userId, message) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function isOnline(userId) {
  const set = sockets.get(userId);
  if (!set) return false;
  for (const ws of set) {
    if (ws.readyState === 1) return true;
  }
  return false;
}

function sideOf(game, userId) {
  if (game.blackId === userId) return 'black';
  if (game.whiteId === userId) return 'white';
  return null;
}

function colorOf(game, userId) {
  if (game.blackId === userId) return BLACK;
  if (game.whiteId === userId) return WHITE;
  return 0;
}

function opponentId(game, userId) {
  if (game.blackId === userId) return game.whiteId;
  if (game.whiteId === userId) return game.blackId;
  return null;
}

function activeGameFor(userId) {
  for (const game of games.values()) {
    if (game.phase !== 'finished' && (game.blackId === userId || game.whiteId === userId)) return game;
  }
  return null;
}

function leaveQueues(userId) {
  for (const queue of queues.values()) {
    const index = queue.indexOf(userId);
    if (index >= 0) queue.splice(index, 1);
  }
}

async function remember(userId) {
  if (names.has(userId)) return names.get(userId);
  const user = await store.findUserById(userId);
  const username = user?.username || 'игрок';
  names.set(userId, username);
  return username;
}

function lastMoveOf(moves) {
  for (let i = moves.length - 1; i >= 0; i -= 1) {
    if (!moves[i].pass) return { x: moves[i].x, y: moves[i].y };
  }
  return null;
}

function present(game, userId) {
  const you = sideOf(game, userId);
  const opponent = opponentId(game, userId);
  const online = opponent ? isOnline(opponent) : false;
  const since = opponent && !online ? disconnectedAt.get(`${game.id}:${opponent}`) || null : null;
  return {
    id: game.id,
    size: game.size,
    komi: game.komi,
    phase: game.phase,
    rev: game.rev,
    black: { id: game.blackId, username: names.get(game.blackId) || 'чёрные' },
    white: { id: game.whiteId, username: names.get(game.whiteId) || 'белые' },
    you,
    turn: game.turn === BLACK ? 'black' : game.turn === WHITE ? 'white' : null,
    board: game.board,
    forbiddenHash: game.forbiddenHash,
    prisoners: {
      black: Number(game.prisoners[BLACK] || 0),
      white: Number(game.prisoners[WHITE] || 0)
    },
    consecutivePasses: game.consecutivePasses,
    yourDead: normalizeDead(game.board, game.deadMarks[userId] || []),
    opponentDead: normalizeDead(game.board, game.deadMarks[opponent] || []),
    youConfirmed: Boolean(game.confirms[userId]),
    opponentConfirmed: Boolean(opponent && game.confirms[opponent]),
    scoreConflict: Boolean(game.scoreConflict),
    scoreBlack: game.scoreBlack,
    scoreWhite: game.scoreWhite,
    winner: game.winner,
    reason: game.reason,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    moveCount: game.moves.length,
    lastMove: lastMoveOf(game.moves),
    opponentOnline: online,
    opponentDisconnectedAt: since,
    claimMs: since ? Math.max(0, DISCONNECT_MS - (Date.now() - since)) : null,
    canClaimWin: Boolean(since && game.phase !== 'finished' && Date.now() - since >= DISCONNECT_MS)
  };
}

function broadcast(game, notice = null) {
  const type = game.phase === 'finished' ? 'game_over' : 'state';
  sendUser(game.blackId, { type, game: present(game, game.blackId), notice });
  sendUser(game.whiteId, { type, game: present(game, game.whiteId), notice });
}

function rejectMove(game, userId, reason) {
  sendUser(userId, { type: 'move_rejected', reason, game: present(game, userId) });
}

function fail(userId, message) {
  sendUser(userId, { type: 'error', message });
}

async function pushFriends(userId) {
  const list = await store.listFriendships(userId);
  sendUser(userId, {
    type: 'friends',
    friends: list.map((item) => ({
      id: item.id,
      status: item.status,
      direction: item.fromId === userId ? 'out' : 'in',
      createdAt: item.createdAt,
      user: item.user,
      online: isOnline(item.user.id)
    }))
  });
}

async function refreshFriends(userId) {
  await pushFriends(userId);
  const list = await store.listFriendships(userId);
  for (const item of list) {
    if (isOnline(item.user.id)) await pushFriends(item.user.id);
  }
}

function listInvites(userId) {
  const now = Date.now();
  const fresh = [];
  for (const invite of invites.values()) {
    if (now - invite.createdAt > 180000) {
      invites.delete(invite.id);
      continue;
    }
    if (invite.toId === userId) {
      fresh.push({
        id: invite.id,
        size: invite.size,
        from: { id: invite.fromId, username: names.get(invite.fromId) || 'игрок' }
      });
    }
  }
  return fresh;
}

function makeGame(blackId, whiteId, size) {
  return {
    id: randomUUID(),
    size,
    komi: KOMI,
    blackId,
    whiteId,
    moves: [],
    board: emptyBoard(size),
    forbiddenHash: null,
    phase: 'playing',
    rev: 0,
    turn: BLACK,
    consecutivePasses: 0,
    prisoners: { 1: 0, 2: 0 },
    deadMarks: { [blackId]: [], [whiteId]: [] },
    confirms: { [blackId]: false, [whiteId]: false },
    scoreConflict: false,
    scoreBlack: null,
    scoreWhite: null,
    winner: null,
    reason: null,
    createdAt: new Date().toISOString(),
    finishedAt: null
  };
}

async function createGame(blackId, whiteId, size) {
  if (activeGameFor(blackId) || activeGameFor(whiteId)) {
    throw new Error('Кто-то из игроков уже в партии');
  }
  leaveQueues(blackId);
  leaveQueues(whiteId);
  for (const invite of invites.values()) {
    if (invite.fromId === blackId || invite.fromId === whiteId || invite.toId === blackId || invite.toId === whiteId) {
      invites.delete(invite.id);
    }
  }
  await remember(blackId);
  await remember(whiteId);
  const game = makeGame(blackId, whiteId, size);
  games.set(game.id, game);
  try {
    await store.saveGame(game);
  } catch (error) {
    games.delete(game.id);
    throw error;
  }
  sendUser(blackId, { type: 'matched', game: present(game, blackId) });
  sendUser(whiteId, { type: 'matched', game: present(game, whiteId) });
  sendUser(blackId, { type: 'queue', searching: false });
  sendUser(whiteId, { type: 'queue', searching: false });
}

function finishGame(game, winner, reason) {
  game.phase = 'finished';
  game.turn = null;
  game.winner = winner;
  game.reason = reason;
  game.finishedAt = new Date().toISOString();
  game.rev += 1;
}

async function persistAndPublish(game, notice) {
  await store.saveGame(game);
  broadcast(game, notice);
  if (game.phase === 'finished') {
    games.delete(game.id);
    disconnectedAt.delete(`${game.id}:${game.blackId}`);
    disconnectedAt.delete(`${game.id}:${game.whiteId}`);
  }
}

function requireGame(userId, gameId) {
  const game = games.get(gameId);
  if (!game || !sideOf(game, userId)) return null;
  return game;
}

async function onMove(userId, msg) {
  await withLock(msg.gameId, async () => {
    const game = requireGame(userId, msg.gameId);
    if (!game) return fail(userId, 'Партия не найдена');
    const rev = Number(msg.rev);
    if (game.phase !== 'playing') return rejectMove(game, userId, 'Сейчас нельзя ставить камень');
    if (rev !== game.rev) return rejectMove(game, userId, 'Позиция уже изменилась');
    const color = colorOf(game, userId);
    if (game.turn !== color) return rejectMove(game, userId, 'Сейчас ход соперника');
    const result = applyMove(game.board, Number(msg.x), Number(msg.y), color, game.forbiddenHash);
    if (!result.ok) return rejectMove(game, userId, result.error);
    game.board = result.board;
    game.forbiddenHash = result.forbiddenHash;
    game.prisoners[color] += result.captured;
    game.moves.push({ x: Number(msg.x), y: Number(msg.y), color, pass: false, captured: result.captured });
    game.consecutivePasses = 0;
    game.turn = opposite(color);
    game.rev += 1;
    await persistAndPublish(game);
  });
}

async function onPass(userId, msg) {
  await withLock(msg.gameId, async () => {
    const game = requireGame(userId, msg.gameId);
    if (!game) return fail(userId, 'Партия не найдена');
    if (game.phase !== 'playing') return rejectMove(game, userId, 'Сейчас нельзя пасовать');
    if (Number(msg.rev) !== game.rev) return rejectMove(game, userId, 'Позиция уже изменилась');
    const color = colorOf(game, userId);
    if (game.turn !== color) return rejectMove(game, userId, 'Сейчас ход соперника');
    game.moves.push({ pass: true, color });
    game.forbiddenHash = boardHash(game.board);
    game.consecutivePasses += 1;
    game.turn = opposite(color);
    game.rev += 1;
    if (game.consecutivePasses >= 2) {
      game.phase = 'scoring';
      game.turn = null;
      game.deadMarks[game.blackId] = [];
      game.deadMarks[game.whiteId] = [];
      game.confirms[game.blackId] = false;
      game.confirms[game.whiteId] = false;
      game.scoreConflict = false;
    }
    await persistAndPublish(game, game.phase === 'scoring' ? 'Оба игрока пасанули. Отметьте мёртвые группы.' : null);
  });
}

async function onResign(userId, msg) {
  await withLock(msg.gameId, async () => {
    const game = requireGame(userId, msg.gameId);
    if (!game) return fail(userId, 'Партия не найдена');
    if (game.phase === 'finished') return fail(userId, 'Партия уже завершена');
    const winner = colorOf(game, userId) === BLACK ? 'white' : 'black';
    finishGame(game, winner, 'resign');
    await persistAndPublish(game);
  });
}

async function onClaim(userId, msg) {
  await withLock(msg.gameId, async () => {
    const game = requireGame(userId, msg.gameId);
    if (!game) return fail(userId, 'Партия не найдена');
    if (game.phase === 'finished') return fail(userId, 'Партия уже завершена');
    const opponent = opponentId(game, userId);
    const since = disconnectedAt.get(`${game.id}:${opponent}`);
    if (!since || isOnline(opponent) || Date.now() - since < DISCONNECT_MS) {
      return fail(userId, 'Соперник ещё может вернуться');
    }
    const winner = sideOf(game, userId);
    finishGame(game, winner, 'disconnect');
    await persistAndPublish(game);
  });
}

async function onMark(userId, msg) {
  await withLock(msg.gameId, async () => {
    const game = requireGame(userId, msg.gameId);
    if (!game) return fail(userId, 'Партия не найдена');
    if (game.phase !== 'scoring') return rejectMove(game, userId, 'Отмечать группы можно только при подсчёте');
    if (Number(msg.rev) !== game.rev) return rejectMove(game, userId, 'Позиция уже изменилась');
    if (!Array.isArray(msg.points)) return rejectMove(game, userId, 'Некорректные отметки');
    game.deadMarks[userId] = normalizeDead(game.board, msg.points);
    game.confirms[game.blackId] = false;
    game.confirms[game.whiteId] = false;
    game.scoreConflict = false;
    game.rev += 1;
    await persistAndPublish(game);
  });
}

async function onConfirm(userId, msg) {
  await withLock(msg.gameId, async () => {
    const game = requireGame(userId, msg.gameId);
    if (!game) return fail(userId, 'Партия не найдена');
    if (game.phase !== 'scoring') return rejectMove(game, userId, 'Подсчёт ещё не начат');
    if (Number(msg.rev) !== game.rev) return rejectMove(game, userId, 'Позиция уже изменилась');
    game.confirms[userId] = true;
    game.rev += 1;
    let notice = null;
    if (game.confirms[game.blackId] && game.confirms[game.whiteId]) {
      const blackMarks = normalizeDead(game.board, game.deadMarks[game.blackId]);
      const whiteMarks = normalizeDead(game.board, game.deadMarks[game.whiteId]);
      if (samePoints(blackMarks, whiteMarks)) {
        const score = scoring(game.board, blackMarks, game.komi);
        for (const point of blackMarks) game.board[point.y][point.x] = 0;
        game.scoreBlack = score.black;
        game.scoreWhite = score.white;
        game.scoreConflict = false;
        finishGame(game, score.winner, 'score');
      } else {
        game.confirms[game.blackId] = false;
        game.confirms[game.whiteId] = false;
        game.scoreConflict = true;
        notice = 'Отметки не совпали. Согласуйте мёртвые группы.';
      }
    }
    await persistAndPublish(game, notice);
  });
}

async function onFind(userId, msg) {
  const size = Number(msg.size);
  await withLock('match', async () => {
    if (!SIZES.has(size)) return fail(userId, 'Доступны поля 9×9, 13×13 и 19×19');
    if (activeGameFor(userId)) return fail(userId, 'Сначала закончите текущую партию');
    leaveQueues(userId);
    const queue = queues.get(size);
    while (queue.length && (queue[0] === userId || activeGameFor(queue[0]))) queue.shift();
    const other = queue.shift();
    if (!other) {
      queue.push(userId);
      sendUser(userId, { type: 'queue', searching: true, size });
      return;
    }
    try {
      await createGame(other, userId, size);
    } catch (error) {
      queue.unshift(other);
      fail(userId, error.message);
    }
  });
}

async function onCancel(userId) {
  await withLock('match', async () => {
    leaveQueues(userId);
    sendUser(userId, { type: 'queue', searching: false });
  });
}

async function onInvite(userId, msg) {
  const size = Number(msg.size);
  const toId = msg.userId;
  if (!SIZES.has(size)) return fail(userId, 'Доступны поля 9×9, 13×13 и 19×19');
  if (activeGameFor(userId)) return fail(userId, 'Сначала закончите текущую партию');
  const friends = await store.listFriendships(userId);
  const friend = friends.find((item) => item.status === 'accepted' && item.user.id === toId);
  if (!friend) return fail(userId, 'Приглашать можно только друзей');
  if (!isOnline(toId)) return fail(userId, 'Друг не в сети');
  if (activeGameFor(toId)) return fail(userId, 'Игрок уже в партии');
  await remember(userId);
  const invite = { id: randomUUID(), fromId: userId, toId, size, createdAt: Date.now() };
  invites.set(invite.id, invite);
  sendUser(toId, {
    type: 'invite',
    invite: { id: invite.id, size, from: { id: userId, username: names.get(userId) } }
  });
  sendUser(userId, { type: 'invite_sent', inviteId: invite.id });
}

async function onAcceptInvite(userId, msg) {
  await withLock('match', async () => {
    const invite = invites.get(msg.inviteId);
    if (!invite || invite.toId !== userId) return fail(userId, 'Приглашение не найдено');
    if (Date.now() - invite.createdAt > 180000) {
      invites.delete(invite.id);
      return fail(userId, 'Приглашение истекло');
    }
    invites.delete(invite.id);
    if (activeGameFor(userId) || activeGameFor(invite.fromId)) {
      return fail(userId, 'Кто-то из игроков уже в партии');
    }
    try {
      await createGame(invite.fromId, userId, invite.size);
    } catch (error) {
      fail(userId, error.message);
    }
  });
}

function onDeclineInvite(userId, msg) {
  const invite = invites.get(msg.inviteId);
  if (!invite || invite.toId !== userId) return fail(userId, 'Приглашение не найдено');
  invites.delete(invite.id);
  sendUser(invite.fromId, { type: 'invite_declined', by: names.get(userId) || 'друг' });
}

async function onFriendRequest(userId, msg) {
  const username = String(msg.username || '').trim();
  const target = await store.findUserByUsername(username);
  if (!target) return fail(userId, 'Игрок не найден');
  if (target.id === userId) return fail(userId, 'Нельзя добавить себя');
  const existing = await store.findFriendshipBetween(userId, target.id);
  if (existing.some((row) => row.status === 'accepted')) return fail(userId, 'Уже в друзьях');
  if (existing.some((row) => row.from_id === userId && row.status === 'pending')) {
    return fail(userId, 'Заявка уже отправлена');
  }
  const incoming = existing.find((row) => row.from_id === target.id && row.status === 'pending');
  try {
    if (incoming) await store.setFriendshipStatus(incoming.id, 'accepted');
    else await store.createFriendship({ id: randomUUID(), fromId: userId, toId: target.id });
  } catch (error) {
    if (error.code === '23505') return fail(userId, 'Заявка уже существует');
    throw error;
  }
  await refreshFriends(userId);
}

async function onFriendAccept(userId, msg) {
  const row = await store.getFriendship(msg.friendshipId);
  if (!row || row.to_id !== userId || row.status !== 'pending') return fail(userId, 'Заявка не найдена');
  await store.setFriendshipStatus(row.id, 'accepted');
  await refreshFriends(userId);
}

async function onFriendRemove(userId, msg) {
  const row = await store.getFriendship(msg.friendshipId);
  if (!row || (row.from_id !== userId && row.to_id !== userId)) return fail(userId, 'Запись не найдена');
  const other = row.from_id === userId ? row.to_id : row.from_id;
  await store.deleteFriendship(row.id);
  await pushFriends(userId);
  await pushFriends(other);
}

async function onResume(userId, msg) {
  const game = (msg.gameId && games.get(msg.gameId)) || activeGameFor(userId);
  if (!game || !sideOf(game, userId)) return sendUser(userId, { type: 'state', game: null });
  disconnectedAt.delete(`${game.id}:${userId}`);
  await remember(game.blackId);
  await remember(game.whiteId);
  sendUser(userId, { type: 'state', game: present(game, userId) });
  const opponent = opponentId(game, userId);
  if (opponent) sendUser(opponent, { type: 'state', game: present(game, opponent) });
}

function markDisconnected(userId) {
  if (isOnline(userId)) return;
  for (const game of games.values()) {
    if (game.phase === 'finished') continue;
    if (game.blackId !== userId && game.whiteId !== userId) continue;
    const key = `${game.id}:${userId}`;
    if (!disconnectedAt.has(key)) disconnectedAt.set(key, Date.now());
    const opponent = opponentId(game, userId);
    if (opponent) sendUser(opponent, { type: 'state', game: present(game, opponent) });
  }
}

const handlers = {
  find_match: onFind,
  cancel_search: async (userId) => onCancel(userId),
  invite: onInvite,
  accept_invite: onAcceptInvite,
  decline_invite: async (userId, msg) => onDeclineInvite(userId, msg),
  move: onMove,
  pass: onPass,
  resign: onResign,
  claim_win: onClaim,
  mark_dead: onMark,
  confirm_score: onConfirm,
  resume: onResume,
  friend_request: onFriendRequest,
  friend_accept: onFriendAccept,
  friend_remove: onFriendRemove
};

function attachSocket(ws, user) {
  ws.userId = user.id;
  names.set(user.id, user.username);
  if (!sockets.has(user.id)) sockets.set(user.id, new Set());
  sockets.get(user.id).add(ws);
  disconnectedAt.forEach((_, key) => {
    if (key.endsWith(`:${user.id}`)) disconnectedAt.delete(key);
  });
}

function detachSocket(ws) {
  const userId = ws.userId;
  if (!userId) return;
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    sockets.delete(userId);
    leaveQueues(userId);
    markDisconnected(userId);
    refreshFriends(userId).catch((error) => console.error(error));
  }
}

function usernameOk(username) {
  return typeof username === 'string' && /^[A-Za-zА-Яа-яЁё0-9_]{3,20}$/.test(username);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(data);
}

async function userFrom(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const session = await store.getSession(token);
  return session?.user || null;
}

function publicGame(game, userId) {
  const you = sideOf(game, userId);
  return {
    id: game.id,
    size: game.size,
    komi: game.komi,
    phase: game.phase,
    moves: game.moves,
    board: game.board,
    winner: game.winner,
    reason: game.reason,
    scoreBlack: game.scoreBlack,
    scoreWhite: game.scoreWhite,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    you,
    result: game.phase !== 'finished' ? 'unfinished' : game.winner === you ? 'win' : 'loss',
    black: { id: game.blackId, username: names.get(game.blackId) || '' },
    white: { id: game.whiteId, username: names.get(game.whiteId) || '' }
  };
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendFile(res, filePath) {
  const type = mime[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  createReadStream(filePath).pipe(res);
}

function publicFile(pathname) {
  let clean = pathname;
  try {
    clean = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  clean = clean.replace(/^\/+/, '');
  if (!clean || clean.endsWith('/')) return path.join(publicDir, 'index.html');
  const filePath = path.normalize(path.join(publicDir, clean));
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return filePath;
}

async function handleHttp(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!usernameOk(username)) {
        return json(res, 400, { error: 'Имя: 3–20 символов, буквы, цифры и _' });
      }
      if (password.length < 4 || password.length > 72) {
        return json(res, 400, { error: 'Пароль: от 4 до 72 символов' });
      }
      if (url.pathname === '/api/register') {
        const taken = await store.findUserByUsername(username);
        if (taken) return json(res, 409, { error: 'Такое имя уже занято' });
        const { salt, hash } = await store.hashPassword(password);
        let user;
        try {
          user = await store.createUser({
            id: randomUUID(),
            username,
            passwordHash: hash,
            salt
          });
        } catch (error) {
          if (error.code === '23505') return json(res, 409, { error: 'Такое имя уже занято' });
          throw error;
        }
        const token = await store.createSession(user.id);
        names.set(user.id, user.username);
        return json(res, 201, { token, user });
      }
      const row = await store.findUserByUsername(username);
      const valid = row && await store.verifyPassword(password, row.salt, row.password_hash);
      if (!valid) return json(res, 401, { error: 'Неверное имя или пароль' });
      const token = await store.createSession(row.id);
      const user = { id: row.id, username: row.username, createdAt: row.created_at };
      names.set(user.id, user.username);
      return json(res, 200, { token, user });
    }
    if (url.pathname.startsWith('/api/')) {
      const user = await userFrom(req);
      if (!user) return json(res, 401, { error: 'Нужно войти' });
      names.set(user.id, user.username);
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        const token = (req.headers.authorization || '').slice(7);
        await store.deleteSession(token);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/me') {
        const active = activeGameFor(user.id);
        return json(res, 200, { user, activeGameId: active?.id || null });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        return json(res, 200, { games: await store.listGamesForUser(user.id) });
      }
      if (req.method === 'GET' && url.pathname === '/api/stats') {
        return json(res, 200, { stats: await store.statsForUser(user.id) });
      }
      if (req.method === 'GET' && url.pathname === '/api/friends') {
        const list = await store.listFriendships(user.id);
        return json(res, 200, {
          friends: list.map((item) => ({
            id: item.id,
            status: item.status,
            direction: item.fromId === user.id ? 'out' : 'in',
            createdAt: item.createdAt,
            user: item.user,
            online: isOnline(item.user.id)
          }))
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/users') {
        const query = (url.searchParams.get('q') || '').trim();
        if (query.length < 1) return json(res, 200, { users: [] });
        return json(res, 200, { users: await store.searchUsers(query.slice(0, 20), user.id) });
      }
      const gameMatch = url.pathname.match(/^\/api\/games\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && gameMatch) {
        const game = games.get(gameMatch[1]) || await store.getGame(gameMatch[1]);
        if (!game || !sideOf(game, user.id)) return json(res, 404, { error: 'Партия не найдена' });
        await remember(game.blackId);
        await remember(game.whiteId);
        return json(res, 200, { game: publicGame(game, user.id) });
      }
      return json(res, 404, { error: 'Не найдено' });
    }

    if (req.method === 'GET' && url.pathname === '/js/rules.js') {
      return sendFile(res, rulesPath);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    const filePath = publicFile(url.pathname);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      return res.end();
    }
    return sendFile(res, filePath);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 400, { error: error.message || 'Ошибка запроса' });
  }
}

async function onSocketMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return send(ws, { type: 'error', message: 'Некорректное сообщение' });
  }
  if (msg.type === 'auth') {
    const session = await store.getSession(String(msg.token || ''));
    if (!session) return send(ws, { type: 'error', message: 'Нужно войти снова' });
    attachSocket(ws, session.user);
    const active = activeGameFor(session.user.id);
    if (active) {
      await remember(active.blackId);
      await remember(active.whiteId);
    }
    send(ws, {
      type: 'auth_ok',
      user: session.user,
      activeGame: active ? present(active, session.user.id) : null,
      invites: listInvites(session.user.id)
    });
    if (active) {
      const opponent = opponentId(active, session.user.id);
      if (opponent) sendUser(opponent, { type: 'state', game: present(active, opponent) });
    }
    await refreshFriends(session.user.id);
    return;
  }
  if (!ws.userId) return send(ws, { type: 'error', message: 'Нет сессии' });
  const handler = handlers[msg.type];
  if (!handler) return send(ws, { type: 'error', message: 'Неизвестная команда' });
  await handler(ws.userId, msg);
}

async function main() {
  await store.migrate();
  const unfinished = await store.listUnfinished();
  const now = Date.now();
  for (const game of unfinished) {
    game.scoreConflict = false;
    games.set(game.id, game);
    await remember(game.blackId);
    await remember(game.whiteId);
    disconnectedAt.set(`${game.id}:${game.blackId}`, now);
    disconnectedAt.set(`${game.id}:${game.whiteId}`, now);
  }

  const server = http.createServer((req, res) => {
    handleHttp(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: 'Ошибка сервера' });
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      onSocketMessage(ws, raw).catch((error) => {
        console.error(error);
        send(ws, { type: 'error', message: 'Ошибка сервера' });
      });
    });
    ws.on('close', () => detachSocket(ws));
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === 1) client.ping();
    }
  }, 25000);

  server.listen(PORT, () => {
    console.log(`Го слушает http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    clearInterval(heartbeat);
    server.close();
    wss.close();
    await store.closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Не удалось запустить сервер. Проверьте PostgreSQL и DATABASE_URL.');
  console.error('Локально: docker compose up -d');
  console.error(error);
  process.exit(1);
});
