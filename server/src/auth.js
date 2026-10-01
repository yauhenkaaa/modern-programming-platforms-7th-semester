'use strict';

const crypto = require('crypto');
const net = require('net');
const express = require('express');
const { config, query, tx, http } = require('./db');
const log = require('./log');

const ipFails = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return 'scrypt:' + salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const dummyHash = hashPassword('unused-password');

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return null;
  return email;
}

function retrySeconds(until) {
  return Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
}

function tooMany(until) {
  const error = http(429, 'TOO_MANY_REQUESTS', 'Вход временно заблокирован', []);
  error.retryAfter = retrySeconds(until);
  return error;
}

function noteUnknownIp(ip) {
  const now = Date.now();
  const windowMs = config.loginLockMin * 60 * 1000;
  const recent = (ipFails.get(ip) || []).filter((time) => now - time < windowMs);
  recent.push(now);
  ipFails.set(ip, recent);
  if (recent.length < config.loginMaxFails) return 0;
  return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
}

function clientIp(req) {
  return String(req.ip || '').slice(0, 64);
}

async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
    if (!match) return next(http(401, 'UNAUTHORIZED', 'Требуется вход', []));
    const { rows } = await query(
      `SELECT s.id, s.expires_at, s.revoked_at, u.id AS user_id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [sha256(match[1])]
    );
    const session = rows[0];
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
      return next(http(401, 'UNAUTHORIZED', 'Ключ недействителен', []));
    }
    await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [session.id]);
    req.user = { id: session.user_id, email: session.email, role: session.role, sessionId: session.id };
    next();
  } catch (error) { next(error); }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(http(401, 'UNAUTHORIZED', 'Требуется вход', []));
    if (!roles.includes(req.user.role)) return next(http(403, 'FORBIDDEN', 'Недостаточно прав', []));
    next();
  };
}

function assertCanMutate(user, authorId) {
  if (!user) throw http(401, 'UNAUTHORIZED', 'Требуется вход', []);
  if (user.role === 'admin') return;
  if (user.role === 'scout' && authorId != null && Number(authorId) === Number(user.id)) return;
  throw http(403, 'FORBIDDEN', 'Недостаточно прав', []);
}

function sendMail(to, link) {
  if (!config.smtpHost) {
    log.warn('smtp not configured', {});
    return Promise.resolve();
  }
  const from = config.mailFrom;
  const subject = 'Восстановление доступа';
  const message = [
    'From: ' + from,
    'To: ' + to,
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    'Ссылка для смены пароля действует ' + config.resetTtlMin + ' минут:',
    link,
    ''
  ].join('\r\n');
  const commands = [
    'EHLO scouting',
    'MAIL FROM:<' + from + '>',
    'RCPT TO:<' + to + '>',
    'DATA',
    message + '\r\n.',
    'QUIT'
  ];
  return new Promise((resolve, reject) => {
    const socket = net.connect(config.smtpPort, config.smtpHost);
    let step = 0;
    let buf = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(8000);
    socket.on('timeout', () => finish(new Error('smtp timeout')));
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!buf.includes('\n')) return;
      const lines = buf.split(/\r?\n/).filter((line) => line !== '');
      const last = lines[lines.length - 1];
      if (last.length < 4 || last[3] === '-') return;
      buf = '';
      const code = Number(last.slice(0, 3));
      if (code >= 400) return finish(new Error('smtp ' + last));
      if (step >= commands.length) return finish();
      socket.write(commands[step] + '\r\n');
      step += 1;
    });
  });
}

async function issueSession(user, req) {
  const active = await query(
    `SELECT COUNT(*)::int AS total FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [user.id]
  );
  if (active.rows[0].total >= config.maxSessions) {
    throw http(409, 'SESSION_LIMIT', 'Достигнут предел активных подключений', []);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlMin * 60 * 1000);
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, sha256(token), expiresAt.toISOString(), clientIp(req), String(req.get('user-agent') || '').slice(0, 300)]
  );
  return { token, expiresAt: expiresAt.toISOString(), role: user.role, email: user.email, id: user.id };
}

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || password.length < 1 || password.length > 72) {
      throw http(400, 'BAD_REQUEST', 'Укажите почту и пароль', []);
    }
    const found = await query(
      'SELECT id, email, password_hash, role, failed_login_count, locked_until FROM users WHERE email = $1',
      [email]
    );
    const user = found.rows[0];
    if (!user) {
      verifyPassword(password, dummyHash);
      const wait = noteUnknownIp(clientIp(req));
      log.warn('login failed', { email });
      if (wait) {
        const error = http(429, 'TOO_MANY_REQUESTS', 'Вход временно заблокирован', []);
        error.retryAfter = wait;
        throw error;
      }
      throw http(401, 'UNAUTHORIZED', 'Неверная почта или пароль', []);
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw tooMany(user.locked_until);
    if (!verifyPassword(password, user.password_hash)) {
      const updated = await query(
        `UPDATE users SET
           failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
         WHERE id = $1
         RETURNING locked_until`,
        [user.id, config.loginMaxFails, config.loginLockMin]
      );
      log.warn('login failed', { email, userId: user.id });
      const lockedUntil = updated.rows[0] && updated.rows[0].locked_until;
      if (lockedUntil) throw tooMany(lockedUntil);
      throw http(401, 'UNAUTHORIZED', 'Неверная почта или пароль', []);
    }
    await query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
    res.json(await issueSession(user, req));
  } catch (error) { next(error); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [req.user.sessionId]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const admin = req.user.role === 'admin';
    const { rows } = await query(
      `SELECT s.id, u.email, u.role, s.created_at, s.expires_at, s.last_seen_at, s.ip, s.user_agent
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > now() AND ($1::boolean OR s.user_id = $2)
       ORDER BY s.id DESC`,
      [admin, req.user.id]
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === req.user.sessionId
      }))
    });
  } catch (error) { next(error); }
});

router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) throw http(400, 'BAD_REQUEST', 'Некорректный идентификатор', []);
    const admin = req.user.role === 'admin';
    const removed = await query(
      `UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now() AND ($2::boolean OR user_id = $3)
       RETURNING id`,
      [Number(req.params.id), admin, req.user.id]
    );
    if (!removed.rowCount) throw http(404, 'NOT_FOUND', 'Сессия не найдена', []);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post('/forgot', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    if (!email) throw http(400, 'BAD_REQUEST', 'Укажите почту', []);
    const found = await query('SELECT id, email FROM users WHERE email = $1', [email]);
    const user = found.rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + config.resetTtlMin * 60 * 1000);
      await tx(async (client) => {
        await client.query(
          'UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
          [user.id]
        );
        await client.query(
          'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
          [user.id, sha256(token), expiresAt.toISOString()]
        );
      });
      const link = config.publicOrigin.replace(/\/$/, '') + '/reset?token=' + encodeURIComponent(token);
      try {
        await sendMail(user.email, link);
        log.info('reset mail sent', { userId: user.id });
      } catch (error) {
        log.error('reset mail failed', { userId: user.id, message: error.message });
      }
    }
    res.status(202).json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/reset', async (req, res, next) => {
  try {
    const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token) || password.length < 4 || password.length > 72) {
      throw http(400, 'BAD_REQUEST', 'Ключ сброса или пароль некорректны', []);
    }
    const found = await query(
      `SELECT id, user_id FROM password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256(token)]
    );
    const row = found.rows[0];
    if (!row) throw http(400, 'BAD_REQUEST', 'Ключ сброса недействителен', []);
    await tx(async (client) => {
      await client.query(
        'UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL WHERE id = $2',
        [hashPassword(password), row.user_id]
      );
      await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
      await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
    });
    res.status(204).end();
  } catch (error) { next(error); }
});

module.exports = { router, requireAuth, requireRole, assertCanMutate, hashPassword };
