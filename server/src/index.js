'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { config, query, pool, HttpError } = require('./db');
const log = require('./log');
const auth = require('./auth');
const reports = require('./reports');
const players = require('./players');

const hits = new Map();

function fail(res, status, code, message, details) {
  res.status(status).json({ error: { code, message, details: details || [] } });
}

function rateLimit(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const now = Date.now();
  const key = req.ip || 'local';
  const recent = (hits.get(key) || []).filter((time) => now - time < 60000);
  if (recent.length >= 30) return fail(res, 429, 'TOO_MANY_REQUESTS', 'Слишком много запросов', []);
  recent.push(now);
  hits.set(key, recent);
  next();
}

function createApp() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.use((req, res, next) => {
    const started = Date.now();
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const pathName = req.path;
    const method = req.method;
    res.on('finish', () => log.info('request', {
      reqId: req.id,
      method,
      path: pathName,
      status: res.statusCode,
      ms: Date.now() - started,
      userId: req.user ? req.user.id : undefined
    }));
    next();
  });
  app.use(rateLimit);
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use('/uploads', (req, res, next) => {
    const name = path.basename(req.path);
    if (name !== req.path.slice(1) || name.includes('..')) return fail(res, 400, 'BAD_REQUEST', 'Некорректное имя файла', []);
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  }, express.static(config.uploadDir, { index: false, dotfiles: 'deny' }));
  app.get('/api/health', async (_req, res) => {
    let database = 'down';
    try { await query('SELECT 1'); database = 'up'; } catch { database = 'down'; }
    res.json({ status: database === 'up' ? 'ok' : 'degraded', version: '1.0.0', database });
  });
  app.use('/api/auth', auth.router);
  app.use('/api/reports', auth.requireAuth, reports.router);
  app.use('/api/players', auth.requireAuth, players.router);
  app.get('/api/dictionaries', auth.requireAuth, players.dictionaries);
  app.use((_req, res) => fail(res, 404, 'NOT_FOUND', 'Ресурс не найден', []));
  app.use((err, req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
      return fail(res, err.status, err.code, err.message, err.details);
    }
    if (err && err.type === 'entity.too.large') return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Тело запроса слишком большое', []);
    if (err instanceof SyntaxError && err.status === 400) return fail(res, 400, 'BAD_REQUEST', 'Некорректный JSON', []);
    log.error('request failed', {
      reqId: req.id,
      method: req.method,
      path: req.path,
      code: err && err.code,
      message: err && err.message
    });
    if (err && err.code === '23514') return fail(res, 400, 'BAD_REQUEST', 'Данные не прошли проверку', []);
    if (err && err.code === '23503') return fail(res, 422, 'UNPROCESSABLE_ENTITY', 'Ссылка на несуществующую запись', []);
    if (err && err.code === '23505') return fail(res, 409, 'CONFLICT', 'Конфликт уникальности', []);
    fail(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера', []);
  });
  return app;
}

if (require.main === module) {
  const server = createApp().listen(config.port, () => log.info('listening', { port: config.port }));
  function shutdown() {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
