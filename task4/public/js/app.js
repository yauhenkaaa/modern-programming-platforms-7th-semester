import { KOMI, groupOf, samePoints, scoring } from '/js/rules.js';

const COLS = 'ABCDEFGHJKLMNOPQRST';
const STARS = {
  9: [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]],
  13: [[3, 3], [3, 9], [6, 6], [9, 3], [9, 9]],
  19: [3, 9, 15].flatMap((y) => [3, 9, 15].map((x) => [x, y]))
};

const boardCanvas = document.getElementById('board');
const historyCanvas = document.getElementById('history-board');
const geoms = new WeakMap();

let token = '';
let user = null;
let socket = null;
let wantSocket = false;
let sessionOk = false;
let retryMs = 1000;
let view = 'auth';
let size = 9;
let searching = false;
let current = null;
let friends = [];
let invites = [];
let hover = null;
let drawnKey = '';
let awayUntil = 0;
let searchTimer = 0;
let toastTimer = 0;
let registerMode = false;
let retryConfirm = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const num = Number(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1).replace('.', ',');
}

function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function placeName(boardSize, x, y) {
  return `${COLS[x] || '?'}${boardSize - y}`;
}

function toast(text) {
  if (!text) return;
  const node = document.getElementById('toast');
  node.hidden = false;
  node.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function syncNav() {
  document.body.classList.toggle('authed', Boolean(user));
  document.getElementById('who').textContent = user ? user.username : '';
  document.getElementById('nav-game').hidden = !current;
  document.querySelectorAll('nav [data-view]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.view === view);
  });
}

function show(name) {
  if (name === 'game' && !current) name = 'lobby';
  view = name;
  for (const section of document.querySelectorAll('main > section')) {
    section.hidden = section.id !== `view-${name}`;
  }
  syncNav();
  if (name === 'lobby') {
    renderQueue();
    renderResume();
    renderInvites();
    renderFriends();
    loadFriends();
  }
  if (name === 'game') requestAnimationFrame(() => renderGame());
  if (name === 'history') loadHistory();
  if (name === 'stats') loadStats();
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/api/login' && path !== '/api/register') {
    dropSession();
    throw new Error(data.error || 'Нужно войти');
  }
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function dropSession() {
  token = '';
  user = null;
  current = null;
  friends = [];
  invites = [];
  searching = false;
  drawnKey = '';
  localStorage.removeItem('go-token');
  wantSocket = false;
  if (socket) {
    const old = socket;
    socket = null;
    old.close();
  }
  document.getElementById('net').hidden = true;
  show('auth');
}

function send(type, extra = {}) {
  if (!socket || socket.readyState !== 1) {
    toast('Нет соединения с сервером');
    return;
  }
  socket.send(JSON.stringify({ type, ...extra }));
}

function connect() {
  if (!token || !wantSocket) return;
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const next = new WebSocket(`${proto}://${location.host}/ws`);
  socket = next;
  next.addEventListener('open', () => {
    sessionOk = false;
    retryMs = 1000;
    next.send(JSON.stringify({ type: 'auth', token }));
  });
  next.addEventListener('message', (event) => {
    if (next !== socket) return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    onServer(msg);
  });
  next.addEventListener('close', () => {
    if (next !== socket || !wantSocket) return;
    document.getElementById('net').hidden = false;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 8000);
  });
}

function takeGame(game, focus) {
  if (!game) return;
  if (!current || current.id !== game.id) {
    hover = null;
    drawnKey = '';
  }
  current = game;
  awayUntil = game.claimMs != null ? Date.now() + game.claimMs : 0;
  syncNav();
  if (focus) show('game');
  else if (view === 'game') renderGame();
  else if (view === 'lobby') renderResume();
}

function onServer(msg) {
  if (msg.type === 'auth_ok') {
    sessionOk = true;
    user = msg.user;
    invites = msg.invites || [];
    document.getElementById('net').hidden = true;
    syncNav();
    const here = view === 'auth' || view === 'lobby' || view === 'game';
    if (msg.activeGame) takeGame(msg.activeGame, here);
    else if (current && current.phase !== 'finished') {
      current = null;
      drawnKey = '';
      if (view === 'game') show('lobby');
    }
    if (view === 'auth') show('lobby');
    else if (view === 'lobby') {
      renderResume();
      renderInvites();
    }
    loadFriends();
    return;
  }
  if (msg.type === 'error') {
    toast(msg.message || 'Ошибка');
    if (!sessionOk) dropSession();
    return;
  }
  if (msg.type === 'matched') {
    searching = false;
    invites = [];
    toast('Соперник найден');
    takeGame(msg.game, true);
    return;
  }
  if (msg.type === 'state' || msg.type === 'game_over' || msg.type === 'move_rejected') {
    if (msg.notice) toast(msg.notice);
    if (msg.reason) toast(msg.reason);
    if (msg.type === 'game_over') searching = false;
    if (msg.game) takeGame(msg.game, msg.type === 'game_over' && (view === 'lobby' || view === 'game'));
    else if (msg.type === 'game_over' && view !== 'game') toast('Партия завершена');
    maybeRetryConfirm();
    return;
  }
  if (msg.type === 'queue') {
    searching = Boolean(msg.searching);
    if (msg.size) size = msg.size;
    if (view === 'lobby') renderQueue();
    return;
  }
  if (msg.type === 'invite') {
    invites = invites.filter((item) => item.id !== msg.invite.id).concat(msg.invite);
    toast(`${msg.invite.from.username} зовёт играть`);
    if (view === 'lobby') renderInvites();
    return;
  }
  if (msg.type === 'invite_sent') return toast('Приглашение отправлено');
  if (msg.type === 'invite_declined') return toast(`${msg.by} отклонил приглашение`);
  if (msg.type === 'friends') {
    friends = msg.friends;
    if (view === 'lobby') {
      renderFriends();
      const query = document.getElementById('user-query').value.trim();
      if (query) searchUsers(query);
    }
  }
}

function maybeRetryConfirm() {
  if (!retryConfirm || !current) return;
  retryConfirm = false;
  if (current.phase === 'scoring' && !current.youConfirmed && samePoints(current.yourDead || [], current.opponentDead || [])) {
    send('confirm_score', { gameId: current.id, rev: current.rev });
  }
}

function renderQueue() {
  const button = document.getElementById('find');
  button.textContent = searching ? 'Отменить поиск' : 'Найти соперника';
  button.classList.toggle('danger', searching);
  document.getElementById('queue-note').textContent = searching ? `Ищем соперника на поле ${size}×${size}` : '';
  document.querySelectorAll('#sizes button').forEach((item) => {
    item.disabled = searching;
    item.classList.toggle('on', Number(item.dataset.size) === size);
  });
}

function renderResume() {
  const node = document.getElementById('resume-note');
  node.innerHTML = current && current.phase !== 'finished'
    ? '<button type="button" class="btn" data-act="resume">Вернуться к партии</button>'
    : '';
}

function personRow(text, actions) {
  return `<div class="person"><span>${text}</span><span>${actions}</span></div>`;
}

function renderInvites() {
  const node = document.getElementById('invites');
  node.innerHTML = invites.length ? `<h3>Приглашения</h3>${invites.map((invite) => personRow(
    `${esc(invite.from.username)} зовёт на ${invite.size}×${invite.size}`,
    `<button type="button" class="btn" data-act="accept-invite" data-id="${esc(invite.id)}">Принять</button>
     <button type="button" class="btn ghost" data-act="decline-invite" data-id="${esc(invite.id)}">Нет</button>`
  )).join('')}` : '';
}

function renderFriends() {
  const node = document.getElementById('friends');
  const list = friends.slice().sort((a, b) => {
    const rank = (item) => (item.status === 'pending' && item.direction === 'in' ? 0 : item.status === 'accepted' ? 1 : 2);
    return rank(a) - rank(b);
  });
  if (!list.length) {
    node.innerHTML = '<p class="muted">Пока никого нет. Найдите игрока по имени.</p>';
    return;
  }
  node.innerHTML = list.map((item) => {
    if (item.status === 'pending' && item.direction === 'in') {
      return personRow(`${esc(item.user.username)} хочет в друзья`, `
        <button type="button" class="btn" data-act="friend-accept" data-id="${esc(item.id)}">Принять</button>
        <button type="button" class="btn ghost" data-act="friend-remove" data-id="${esc(item.id)}">Отклонить</button>`);
    }
    if (item.status === 'pending') {
      return personRow(`${esc(item.user.username)} · заявка отправлена`,
        `<button type="button" class="btn ghost" data-act="friend-remove" data-id="${esc(item.id)}">Отменить</button>`);
    }
    const online = item.online ? 'в сети' : 'не в сети';
    return personRow(
      `<i class="dot ${item.online ? 'on' : ''}"></i> ${esc(item.user.username)} <small>${online}</small>`,
      `<button type="button" class="btn" data-act="invite" data-id="${esc(item.user.id)}" ${item.online ? '' : 'disabled'}>Звать</button>
       <button type="button" class="btn ghost" data-act="friend-remove" data-id="${esc(item.id)}">Удалить</button>`
    );
  }).join('');
}

async function loadFriends() {
  if (!token) return;
  try {
    const data = await api('/api/friends');
    friends = data.friends;
    if (view === 'lobby') renderFriends();
  } catch (error) {
    if (token) toast(error.message);
  }
}

async function searchUsers(query) {
  const node = document.getElementById('user-results');
  if (!query) {
    node.innerHTML = '';
    return;
  }
  try {
    const data = await api(`/api/users?q=${encodeURIComponent(query)}`);
    const known = new Map(friends.map((item) => [item.user.id, item.status]));
    if (!data.users.length) {
      node.innerHTML = '<p class="muted">Никого не нашли</p>';
      return;
    }
    node.innerHTML = data.users.map((item) => {
      const state = known.get(item.id);
      const action = state === 'accepted'
        ? '<span class="muted">уже в друзьях</span>'
        : state === 'pending'
          ? '<span class="muted">заявка есть</span>'
          : `<button type="button" class="btn" data-act="friend-add" data-name="${esc(item.username)}">В друзья</button>`;
      return personRow(esc(item.username), action);
    }).join('');
  } catch (error) {
    if (token) toast(error.message);
  }
}

function phaseText(game) {
  if (game.phase === 'finished') return 'Партия завершена';
  if (game.phase === 'scoring') return 'Подсчёт';
  return game.turn === game.you ? 'Ваш ход' : 'Ход соперника';
}

function outcome(game) {
  const mine = game.winner === game.you;
  const lead = mine ? 'Вы победили' : 'Вы проиграли';
  if (game.reason === 'resign') return `${lead}: ${mine ? 'соперник сдался' : 'вы сдались'}`;
  if (game.reason === 'disconnect') return `${lead}: ${mine ? 'соперник не вернулся' : 'вас не было больше минуты'}`;
  return `${lead}. Счёт ${fmt(game.scoreBlack)} : ${fmt(game.scoreWhite)} (чёрные : белые)`;
}

function playerRow(game, side) {
  const person = game[side];
  const who = side === 'black' ? 'чёрные' : 'белые';
  const me = game.you === side ? ' · вы' : '';
  const komi = side === 'white' ? ` · коми ${fmt(game.komi)}` : '';
  return `<div class="player ${game.turn === side ? 'on' : ''}">
    <i class="${side}"></i>
    <span><b>${esc(person.username)}</b><small>${who}${me}${komi}</small></span>
    <b title="Снято камней">${game.prisoners[side]}</b>
  </div>`;
}

function panelHTML(game) {
  const myTurn = game.phase === 'playing' && game.turn === game.you;
  const aligned = samePoints(game.yourDead || [], game.opponentDead || []);
  let actions = '';
  if (game.phase === 'playing') {
    actions = `<button type="button" class="btn primary" data-act="pass" ${myTurn ? '' : 'disabled'}>Пас</button>
      <button type="button" class="btn danger" data-act="resign">Сдаться</button>`;
  } else if (game.phase === 'scoring') {
    const preview = scoring(game.board, game.yourDead || [], game.komi);
    actions = `<p>По вашей разметке: чёрные ${fmt(preview.black)}, белые ${fmt(preview.white)}.</p>
      <p class="muted">${aligned ? 'Разметка совпадает.' : 'Отметки пока разные.'}${game.opponentConfirmed ? ' Соперник уже подтвердил.' : ''}</p>
      <button type="button" class="btn primary" data-act="confirm" ${aligned && !game.youConfirmed ? '' : 'disabled'}>${game.youConfirmed ? 'Ждём соперника' : 'Подтвердить'}</button>
      <button type="button" class="btn" data-act="clear-dead">Снять отметки</button>
      <button type="button" class="btn danger" data-act="resign">Сдаться</button>`;
  } else {
    actions = `<p class="outcome">${esc(outcome(game))}</p>
      <button type="button" class="btn primary" data-act="lobby">В комнату</button>`;
  }
  const presence = game.phase === 'finished' ? '' : game.opponentOnline
    ? '<p class="muted">Соперник в сети</p>'
    : '<p id="away-line" class="warn"></p><button type="button" id="claim-btn" class="btn danger" data-act="claim" hidden>Засчитать победу</button>';
  const hint = game.phase === 'scoring'
    ? 'Нажмите на группу, чтобы отметить её мёртвой.'
    : game.phase === 'playing' && myTurn
      ? 'Нажмите на пустой пункт.'
      : game.phase === 'playing' ? 'Сейчас ход соперника.' : 'Запись сохранена в истории.';
  return `<p class="phase">${phaseText(game)}</p>
    <p class="muted">Снято камней</p>
    ${playerRow(game, 'black')}
    ${playerRow(game, 'white')}
    <p class="muted">Ходов: ${game.moveCount || 0}${game.consecutivePasses ? ` · пасов подряд: ${game.consecutivePasses}` : ''}</p>
    ${presence}
    <div class="actions">${actions}</div>
    <p class="muted">${hint}</p>`;
}

function tickAway() {
  const line = document.getElementById('away-line');
  const button = document.getElementById('claim-btn');
  if (!line) return;
  const left = Math.max(0, awayUntil - Date.now());
  if (left > 0) {
    line.textContent = `Соперник не в сети. Через ${Math.ceil(left / 1000)} с можно засчитать победу.`;
    if (button) button.hidden = true;
  } else {
    line.textContent = 'Соперника нет больше минуты.';
    if (button) button.hidden = false;
  }
}

function renderGame() {
  if (!current || view !== 'game') return;
  const key = [current.id, current.rev, current.youConfirmed, current.opponentConfirmed, current.opponentOnline, current.phase, current.winner].join(':');
  if (key !== drawnKey) {
    document.getElementById('panel').innerHTML = panelHTML(current);
    drawnKey = key;
  }
  drawBoard(boardCanvas, current, hover);
  tickAway();
}

function drawBoard(canvas, game, pointer) {
  const css = canvas.clientWidth;
  if (!game?.board || !Array.isArray(game.board) || css < 40) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const boardSize = game.size;
  const margin = Math.max(44, css * 0.15);
  const step = (css - margin * 2) / (boardSize - 1);
  const radius = Math.min(step * 0.46, margin * 0.55);
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  geoms.set(canvas, { margin, step, size: boardSize });

  const wood = ctx.createLinearGradient(0, 0, css, css);
  wood.addColorStop(0, '#f0d7a4');
  wood.addColorStop(1, '#e0b678');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, css, css);
  ctx.strokeStyle = '#3a2a1c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < boardSize; i += 1) {
    ctx.moveTo(margin, margin + i * step);
    ctx.lineTo(margin + (boardSize - 1) * step, margin + i * step);
    ctx.moveTo(margin + i * step, margin);
    ctx.lineTo(margin + i * step, margin + (boardSize - 1) * step);
  }
  ctx.stroke();
  ctx.fillStyle = '#3a2a1c';
  for (const [x, y] of STARS[boardSize] || []) {
    ctx.beginPath();
    ctx.arc(margin + x * step, margin + y * step, Math.max(2.5, step * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = '12px "Segoe UI", sans-serif';
  ctx.fillStyle = '#5c4632';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 0; x < boardSize; x += 1) ctx.fillText(COLS[x], margin + x * step, 16);
  for (let y = 0; y < boardSize; y += 1) ctx.fillText(String(boardSize - y), 16, margin + y * step);

  const yours = new Set((game.yourDead || []).map((point) => `${point.x},${point.y}`));
  const theirs = new Set((game.opponentDead || []).map((point) => `${point.x},${point.y}`));
  const at = (x, y) => [margin + x * step, margin + y * step];
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const color = game.board[y][x];
      if (!color) continue;
      const [px, py] = at(x, y);
      const gradient = ctx.createRadialGradient(px - radius * 0.35, py - radius * 0.4, radius * 0.15, px, py, radius);
      if (color === 1) {
        gradient.addColorStop(0, '#5a544c');
        gradient.addColorStop(1, '#161311');
      } else {
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, '#d7d0c4');
      }
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      const key = `${x},${y}`;
      if (yours.has(key)) {
        ctx.strokeStyle = '#9c2f24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - radius * 0.32, py - radius * 0.32);
        ctx.lineTo(px + radius * 0.32, py + radius * 0.32);
        ctx.moveTo(px + radius * 0.32, py - radius * 0.32);
        ctx.lineTo(px - radius * 0.32, py + radius * 0.32);
        ctx.stroke();
      } else if (theirs.has(key)) {
        ctx.strokeStyle = '#9c2f24';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, radius * 0.48, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  if (game.lastMove && game.board[game.lastMove.y]?.[game.lastMove.x]) {
    const [px, py] = at(game.lastMove.x, game.lastMove.y);
    ctx.fillStyle = game.board[game.lastMove.y][game.lastMove.x] === 1 ? '#f3efe6' : '#9c2f24';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, radius * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }

  if (!pointer) return;
  const [px, py] = at(pointer.x, pointer.y);
  if (game.phase === 'playing' && game.turn === game.you && game.board[pointer.y][pointer.x] === 0) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = game.you === 'black' ? '#1a1714' : '#f7f4ee';
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (game.phase === 'scoring' && game.board[pointer.y][pointer.x]) {
    ctx.strokeStyle = '#9c2f24';
    ctx.lineWidth = 2;
    for (const stone of groupOf(game.board, pointer.x, pointer.y)) {
      const [sx, sy] = at(stone.x, stone.y);
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function pointFromEvent(canvas, event) {
  const geom = geoms.get(canvas);
  if (!geom) return null;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const gx = Math.round((x - geom.margin) / geom.step);
  const gy = Math.round((y - geom.margin) / geom.step);
  if (gx < 0 || gy < 0 || gx >= geom.size || gy >= geom.size) return null;
  const px = geom.margin + gx * geom.step;
  const py = geom.margin + gy * geom.step;
  if (Math.hypot(x - px, y - py) > geom.step * 0.48) return null;
  return { x: gx, y: gy };
}

function playAt(x, y) {
  if (!current || current.phase !== 'playing' || current.turn !== current.you) return;
  if (current.board[y][x] !== 0) return;
  send('move', { gameId: current.id, x, y, rev: current.rev });
}

function toggleDead(x, y) {
  const group = groupOf(current.board, x, y);
  if (!group.length) return;
  const keys = new Set(group.map((point) => `${point.x},${point.y}`));
  const mine = new Set((current.yourDead || []).map((point) => `${point.x},${point.y}`));
  const marked = group.every((point) => mine.has(`${point.x},${point.y}`));
  const next = marked
    ? current.yourDead.filter((point) => !keys.has(`${point.x},${point.y}`))
    : current.yourDead.concat(group);
  send('mark_dead', { gameId: current.id, rev: current.rev, points: next.map((point) => ({ x: point.x, y: point.y })) });
}

function resultLabel(game) {
  const word = game.result === 'win' ? 'победа' : game.result === 'loss' ? 'поражение' : 'не закончена';
  const why = { resign: 'сдача', disconnect: 'неявка', score: 'по очкам' }[game.reason];
  if (game.reason === 'score' && game.scoreBlack != null) return `${word} ${fmt(game.scoreBlack)}:${fmt(game.scoreWhite)}`;
  return why && game.result !== 'unfinished' ? `${word}, ${why}` : word;
}

async function loadHistory() {
  if (!token) return;
  try {
    const data = await api('/api/history');
    const node = document.getElementById('history-list');
    node.innerHTML = data.games.length ? data.games.map((game) => `
      <button type="button" class="hist" data-act="open-game" data-id="${esc(game.id)}">
        <span>${when(game.createdAt)} · ${game.size}×${game.size} · ${game.you === 'black' ? 'чёрные' : 'белые'}</span>
        <span>${esc(game.opponent.username)}</span>
        <b class="result ${game.result}">${esc(resultLabel(game))}</b>
      </button>`).join('') : '<p class="muted">Сыгранных партий пока нет.</p>';
  } catch (error) {
    if (token) toast(error.message);
  }
}

async function openHistoryGame(id) {
  try {
    const data = await api(`/api/games/${id}`);
    const game = data.game;
    const preview = document.getElementById('history-preview');
    preview.hidden = false;
    document.getElementById('history-caption').textContent = `${game.black.username} — ${game.white.username}`;
    document.getElementById('history-meta').textContent = game.phase === 'finished'
      ? `${resultLabel(game)}. Показана итоговая позиция.`
      : 'Партия ещё идёт. Показана текущая позиция.';
    const last = [...(game.moves || [])].reverse().find((move) => !move.pass) || null;
    requestAnimationFrame(() => drawBoard(historyCanvas, {
      size: game.size,
      board: game.board,
      phase: 'finished',
      lastMove: last,
      yourDead: [],
      opponentDead: []
    }, null));
  } catch (error) {
    if (token) toast(error.message);
  }
}

async function loadStats() {
  if (!token) return;
  try {
    const { stats } = await api('/api/stats');
    const node = document.getElementById('stats');
    if (!stats.played) {
      node.innerHTML = '<p class="muted">Когда завершится первая партия, здесь появятся победы и поражения.</p>';
      return;
    }
    const rate = Math.round(stats.winRate * 100);
    const card = (label, value) => `<div class="stat"><span class="muted">${label}</span><b>${value}</b></div>`;
    node.innerHTML = `<div class="stat-grid">
        ${card('Партии', stats.played)}
        ${card('Победы', stats.wins)}
        ${card('Поражения', stats.losses)}
        ${card('Доля побед', `${rate}%`)}
      </div>
      <div class="bar" aria-hidden="true"><span style="width:${rate}%"></span></div>
      <p>Чёрными: ${stats.black.wins} из ${stats.black.played}</p>
      <p>Белыми: ${stats.white.wins} из ${stats.white.played}</p>`;
  } catch (error) {
    if (token) toast(error.message);
  }
}

function onAction(act) {
  const id = act.dataset.id;
  if (act.dataset.act === 'size') {
    if (searching) return;
    size = Number(act.dataset.size);
    renderQueue();
  } else if (act.dataset.act === 'find') {
    if (current && current.phase !== 'finished') return toast('Сначала закончите текущую партию');
    if (searching) send('cancel_search');
    else send('find_match', { size });
  } else if (act.dataset.act === 'resume') show('game');
  else if (act.dataset.act === 'lobby') show('lobby');
  else if (act.dataset.act === 'pass') send('pass', { gameId: current.id, rev: current.rev });
  else if (act.dataset.act === 'resign' && window.confirm('Сдаться и отдать партию сопернику?')) send('resign', { gameId: current.id });
  else if (act.dataset.act === 'claim' && window.confirm('Засчитать себе победу из-за отсутствия соперника?')) send('claim_win', { gameId: current.id });
  else if (act.dataset.act === 'confirm') {
    retryConfirm = true;
    send('confirm_score', { gameId: current.id, rev: current.rev });
  }
  else if (act.dataset.act === 'clear-dead') send('mark_dead', { gameId: current.id, rev: current.rev, points: [] });
  else if (act.dataset.act === 'accept-invite') send('accept_invite', { inviteId: id });
  else if (act.dataset.act === 'decline-invite') {
    invites = invites.filter((item) => item.id !== id);
    renderInvites();
    send('decline_invite', { inviteId: id });
  } else if (act.dataset.act === 'friend-add') send('friend_request', { username: act.dataset.name });
  else if (act.dataset.act === 'friend-accept') send('friend_accept', { friendshipId: id });
  else if (act.dataset.act === 'friend-remove') send('friend_remove', { friendshipId: id });
  else if (act.dataset.act === 'invite') send('invite', { userId: id, size });
  else if (act.dataset.act === 'open-game') openHistoryGame(id);
}

document.body.addEventListener('click', (event) => {
  const viewBtn = event.target.closest('[data-view]');
  if (viewBtn) {
    const next = viewBtn.dataset.view === 'home' ? (user ? 'lobby' : 'auth') : viewBtn.dataset.view;
    show(next);
    return;
  }
  const act = event.target.closest('[data-act]');
  if (act) onAction(act);
});

document.getElementById('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById('auth-error');
  error.textContent = '';
  const username = form.username.value.trim();
  if (!/^[A-Za-zА-Яа-яЁё0-9_]{3,20}$/.test(username)) {
    error.textContent = 'Имя: 3–20 символов, буквы, цифры и _';
    return;
  }
  try {
    const data = await api(registerMode ? '/api/register' : '/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: form.password.value })
    });
    token = data.token;
    user = data.user;
    localStorage.setItem('go-token', token);
    wantSocket = true;
    show('lobby');
    connect();
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById('auth-switch').addEventListener('click', () => {
  registerMode = !registerMode;
  document.querySelector('#auth-form button[type="submit"]').textContent = registerMode ? 'Создать профиль' : 'Войти';
  document.getElementById('auth-switch').textContent = registerMode ? 'У меня уже есть профиль' : 'Создать профиль';
  document.querySelector('#auth-form input[type="password"]').autocomplete = registerMode ? 'new-password' : 'current-password';
  document.getElementById('auth-error').textContent = '';
});

document.getElementById('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* сессия уже сброшена */ }
  if (token) dropSession();
});

document.getElementById('find-user').addEventListener('submit', (event) => {
  event.preventDefault();
  searchUsers(document.getElementById('user-query').value.trim());
});

document.getElementById('user-query').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const value = event.target.value.trim();
  searchTimer = setTimeout(() => searchUsers(value), 250);
});

boardCanvas.addEventListener('pointerdown', (event) => {
  if (!current || view !== 'game' || current.phase === 'finished') return;
  event.preventDefault();
  const point = pointFromEvent(boardCanvas, event);
  if (!point) return;
  if (current.phase === 'scoring') {
    if (current.board[point.y][point.x]) toggleDead(point.x, point.y);
    return;
  }
  playAt(point.x, point.y);
});

boardCanvas.addEventListener('pointermove', (event) => {
  if (!current || view !== 'game') return;
  hover = pointFromEvent(boardCanvas, event);
  document.getElementById('coord').textContent = hover ? placeName(current.size, hover.x, hover.y) : '';
  const legal = hover && (
    (current.phase === 'playing' && current.turn === current.you && current.board[hover.y][hover.x] === 0)
    || (current.phase === 'scoring' && current.board[hover.y][hover.x] !== 0)
  );
  boardCanvas.style.cursor = legal ? 'pointer' : 'default';
  drawBoard(boardCanvas, current, hover);
});

boardCanvas.addEventListener('pointerleave', () => {
  hover = null;
  document.getElementById('coord').textContent = '';
  if (current && view === 'game') drawBoard(boardCanvas, current, null);
});

new ResizeObserver(() => {
  if (view === 'game') drawBoard(boardCanvas, current, hover);
}).observe(boardCanvas.parentElement);

setInterval(tickAway, 400);
window.addEventListener('online', () => { if (wantSocket) connect(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wantSocket && (!socket || socket.readyState > 1)) connect();
});

document.querySelectorAll('[data-komi]').forEach((node) => { node.textContent = fmt(KOMI); });

async function boot() {
  token = localStorage.getItem('go-token') || '';
  if (!token) return show('auth');
  try {
    const data = await api('/api/me');
    user = data.user;
    wantSocket = true;
    show('lobby');
    connect();
  } catch (error) {
    if (!localStorage.getItem('go-token')) return;
    toast(error.message || 'Сервер недоступен');
    show('auth');
  }
}

boot();
