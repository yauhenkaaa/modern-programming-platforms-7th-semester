'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { config, query, tx, http } = require('./db');
const players = require('./players');

const GRADES = ['skating', 'shooting', 'passing', 'hockeyIq', 'physicality', 'defensivePlay', 'discipline', 'potential'];
const FIELDS = {
  playerId: ['player_id', 'int', 1, 2147483647, true],
  scoutName: ['scout_name', 'str', 1, 120, true],
  reportDate: ['report_date', 'date', 0, 0, true],
  matchesObserved: ['matches_observed', 'int', 3, 32767, true],
  skating: ['skating', 'int', 1, 10, true],
  shooting: ['shooting', 'int', 1, 10, true],
  passing: ['passing', 'int', 1, 10, true],
  hockeyIq: ['hockey_iq', 'int', 1, 10, true],
  physicality: ['physicality', 'int', 1, 10, true],
  defensivePlay: ['defensive_play', 'int', 1, 10, true],
  discipline: ['discipline', 'int', 1, 10, true],
  potential: ['potential', 'int', 1, 10, true],
  overallGrade: ['overall_grade', 'num', 1, 10, true],
  recommendation: ['recommendation', 'enum', 0, 0, true],
  observedMatches: ['observed_matches', 'str', 0, 10000, false],
  projection: ['projection', 'str', 0, 200, false],
  strengths: ['strengths', 'str', 0, 10000, false],
  weaknesses: ['weaknesses', 'str', 0, 10000, false],
  summary: ['summary', 'str', 0, 10000, false]
};
const INTS = {
  ageMin: [14, 75], ageMax: [14, 75], nationId: [1, 2147483647], clubId: [1, 2147483647],
  matchesObservedMin: [3, 32767], goalsMin: [0, 32767], goalsMax: [0, 32767],
  assistsMin: [0, 32767], assistsMax: [0, 32767], pointsMin: [0, 32767], pointsMax: [0, 32767],
  pimMin: [0, 32767], pimMax: [0, 32767], plusMinusMin: [-200, 200], plusMinusMax: [-200, 200],
  gpMin: [0, 32767], gpMax: [0, 32767]
};
const NUMS = {
  gradeMin: [1, 10], gradeMax: [1, 10], faceoffPctMin: [0, 100], faceoffPctMax: [0, 100],
  savePctMin: [0, 100], savePctMax: [0, 100], gaaMin: [0, 100], gaaMax: [0, 100]
};
const RANGES = [
  ['ageMin', 'ageMax'], ['gradeMin', 'gradeMax'], ['goalsMin', 'goalsMax'], ['assistsMin', 'assistsMax'],
  ['pointsMin', 'pointsMax'], ['pimMin', 'pimMax'], ['plusMinusMin', 'plusMinusMax'],
  ['faceoffPctMin', 'faceoffPctMax'], ['savePctMin', 'savePctMax'], ['gaaMin', 'gaaMax'], ['gpMin', 'gpMax']
];
const SORT = {
  reportDate: 'r.report_date', overallGrade: 'r.overall_grade', matchesObserved: 'r.matches_observed',
  createdAt: 'r.created_at', scoutName: 'r.scout_name', surname: 'p.surname',
  age: "date_part('year', age(p.dob))", goals: 'css_sort.goals', assists: 'css_sort.assists',
  points: 'css_sort.points', gp: 'css_sort.gp', plusMinus: 'css_sort.plus_minus', pim: 'css_sort.pim',
  savePct: 'css_sort.save_pct', gaa: 'css_sort.gaa', faceoffPct: 'css_sort.faceoff_pct'
};
const STAT = {
  goalsMin: 'css.goals >= ', goalsMax: 'css.goals <= ', assistsMin: 'css.assists >= ', assistsMax: 'css.assists <= ',
  pointsMin: 'css.points >= ', pointsMax: 'css.points <= ', pimMin: 'css.pim >= ', pimMax: 'css.pim <= ',
  plusMinusMin: 'css.plus_minus >= ', plusMinusMax: 'css.plus_minus <= ', faceoffPctMin: 'css.faceoff_pct >= ',
  faceoffPctMax: 'css.faceoff_pct <= ', savePctMin: 'css.save_pct >= ', savePctMax: 'css.save_pct <= ',
  gaaMin: 'css.gaa >= ', gaaMax: 'css.gaa <= ', gpMin: 'css.gp >= ', gpMax: 'css.gp <= '
};
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function detail(field, message) { return { field, message }; }

function present(value) { return value !== undefined && value !== null && String(value).trim() !== ''; }

function readInt(raw, field, min, max, details) {
  if (!/^-?\d+$/.test(String(raw).trim())) { details.push(detail(field, 'Ожидается целое число')); return; }
  const value = Number(raw);
  if (value < min || value > max) details.push(detail(field, 'Диапазон ' + min + '..' + max));
  return value;
}

function readNum(raw, field, min, max, details) {
  if (!/^-?\d+(\.\d+)?$/.test(String(raw).trim())) { details.push(detail(field, 'Ожидается число')); return; }
  const value = Number(raw);
  if (value < min || value > max) details.push(detail(field, 'Диапазон ' + min + '..' + max));
  return value;
}

function parseFilters(source) {
  const details = [];
  const filters = {};
  for (const [name, bounds] of Object.entries(INTS)) {
    if (!present(source[name])) continue;
    const value = readInt(source[name], name, bounds[0], bounds[1], details);
    if (value !== undefined && !details.some((item) => item.field === name)) filters[name] = value;
  }
  for (const [name, bounds] of Object.entries(NUMS)) {
    if (!present(source[name])) continue;
    const value = readNum(source[name], name, bounds[0], bounds[1], details);
    if (value !== undefined && !details.some((item) => item.field === name)) filters[name] = value;
  }
  const enums = { position: players.POSITIONS, hand: players.HANDS, recommendation: players.RECOMMENDATIONS };
  for (const [name, allowed] of Object.entries(enums)) {
    if (!present(source[name])) continue;
    if (!allowed.includes(String(source[name]))) details.push(detail(name, 'Недопустимое значение'));
    else filters[name] = String(source[name]);
  }
  for (const name of ['isUfa', 'hasDocument']) {
    if (!present(source[name])) continue;
    const text = String(source[name]).trim().toLowerCase();
    if (text === 'true' || text === '1') filters[name] = true;
    else if (text === 'false' || text === '0') filters[name] = false;
    else details.push(detail(name, 'Ожидается true или false'));
  }
  if (present(source.q)) {
    const q = String(source.q).trim();
    if (q.includes('\0') || q.length > 120) details.push(detail('q', 'Недопустимая строка поиска'));
    else filters.q = q;
  }
  filters.sort = present(source.sort) ? String(source.sort).trim() : 'reportDate';
  filters.order = present(source.order) ? String(source.order).trim().toLowerCase() : 'desc';
  if (!SORT[filters.sort]) details.push(detail('sort', 'Неизвестный ключ сортировки'));
  if (filters.order !== 'asc' && filters.order !== 'desc') details.push(detail('order', 'Допустимы asc или desc'));
  const page = present(source.page) ? readInt(source.page, 'page', 1, 2147483647, details) : 1;
  const limit = present(source.limit) ? readInt(source.limit, 'limit', 1, 100, details) : 20;
  for (const [minName, maxName] of RANGES) {
    if (filters[minName] !== undefined && filters[maxName] !== undefined && filters[minName] > filters[maxName]) {
      details.push(detail(minName, minName + ' больше ' + maxName));
    }
  }
  if (details.length) throw http(400, 'BAD_REQUEST', 'Некорректные параметры запроса', details);
  return { filters, page, limit };
}

function parseBody(body, mode) {
  const details = [];
  const value = {};
  const source = body || {};
  for (const [name, spec] of Object.entries(FIELDS)) {
    const required = spec[4];
    const hasKey = Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined && source[name] !== null;
    const has = hasKey && String(source[name]).trim() !== '';
    if (!has) {
      if (required && (mode !== 'patch' || hasKey)) details.push(detail(name, 'Обязательное поле'));
      else if (!required && (mode !== 'patch' || hasKey)) value[name] = null;
      continue;
    }
    const raw = String(source[name]);
    if (raw.includes('\0')) { details.push(detail(name, 'Недопустимые символы')); continue; }
    if (spec[1] === 'int') {
      const parsed = readInt(raw, name, spec[2], spec[3], details);
      if (parsed !== undefined) value[name] = parsed;
    } else if (spec[1] === 'num') {
      const parsed = readNum(raw, name, spec[2], spec[3], details);
      if (parsed !== undefined) value[name] = parsed;
    } else if (spec[1] === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) || raw.trim() < '2008-09-01' || raw.trim() > '2100-01-01') {
        details.push(detail(name, 'Дата в формате YYYY-MM-DD'));
      } else value[name] = raw.trim();
    } else if (spec[1] === 'enum') {
      if (!players.RECOMMENDATIONS.includes(raw)) details.push(detail(name, 'sign, monitor или pass'));
      else value[name] = raw;
    } else {
      const text = raw.trim();
      if (text.length < spec[2] || text.length > spec[3]) details.push(detail(name, 'Длина ' + spec[2] + '..' + spec[3]));
      else value[name] = text;
    }
  }
  if (value.overallGrade !== undefined && GRADES.every((name) => value[name] !== undefined)) {
    const avg = GRADES.reduce((sum, name) => sum + value[name], 0) / 8;
    if (Math.abs(value.overallGrade - avg) > 1.5) details.push(detail('overallGrade', 'Отклонение от среднего оценок больше 1.5'));
  }
  let removeDocument = false;
  if (present(source.removeDocument)) {
    const text = String(source.removeDocument).trim().toLowerCase();
    if (text === 'true' || text === '1') removeDocument = true;
    else if (text !== 'false' && text !== '0') details.push(detail('removeDocument', 'Ожидается true или false'));
  }
  if (details.length) throw http(400, 'BAD_REQUEST', 'Некорректные данные отчёта', details);
  return { value, removeDocument };
}

function toRow(value, file, full) {
  const row = {};
  for (const [name, spec] of Object.entries(FIELDS)) {
    if (full || Object.prototype.hasOwnProperty.call(value, name)) row[spec[0]] = value[name] === undefined ? null : value[name];
  }
  if (file) {
    row.document_path = file.filename;
    row.document_original_name = path.basename(file.originalname).replace(/[^\w.\- ()а-яА-ЯёЁ]/g, '_').slice(0, 180) || 'document';
    row.document_mime = file.detectedMime;
    row.document_size_bytes = file.size;
  } else if (full) {
    row.document_path = null;
    row.document_original_name = null;
    row.document_mime = null;
    row.document_size_bytes = null;
  }
  return row;
}

const REPORT_SQL = `
  SELECT r.id AS r_id, r.player_id, r.scout_name, r.report_date, r.matches_observed, r.observed_matches,
    r.skating, r.shooting, r.passing, r.hockey_iq, r.physicality, r.defensive_play, r.discipline, r.potential,
    r.overall_grade, r.recommendation, r.projection, r.strengths, r.weaknesses, r.summary,
    r.document_path, r.document_original_name, r.document_mime, r.document_size_bytes, r.created_at, r.updated_at,
    p.id AS p_id, p.name AS p_name, p.patronymic AS p_patronymic, p.surname AS p_surname, p.dob AS p_dob,
    date_part('year', age(p.dob))::int AS p_age, p.position AS p_position, p.hand AS p_hand,
    p.jersey_number AS p_jersey_number, p.height_cm AS p_height_cm, p.weight_kg AS p_weight_kg,
    p.photo AS p_photo, p.bio AS p_bio, p.is_ufa AS p_is_ufa, p.contract_until AS p_contract_until,
    n.id AS n_id, n.nation_name AS n_name, n.iso_code AS n_iso, n.flag_url AS n_flag,
    c.id AS c_id, c.name AS c_name, c.city AS c_city, c.logo AS c_logo, c.arena AS c_arena,
    c.bio AS c_bio, c.division AS c_division, c.conference AS c_conference
  FROM reports r JOIN players p ON p.id = r.player_id JOIN nations n ON n.id = p.nation_id
  LEFT JOIN clubs c ON c.id = p.current_club_id`;

function mapReport(row, current, history) {
  return {
    id: row.r_id, playerId: row.player_id, scoutName: row.scout_name, reportDate: row.report_date,
    matchesObserved: row.matches_observed, observedMatches: row.observed_matches, skating: row.skating,
    shooting: row.shooting, passing: row.passing, hockeyIq: row.hockey_iq, physicality: row.physicality,
    defensivePlay: row.defensive_play, discipline: row.discipline, potential: row.potential,
    overallGrade: row.overall_grade, recommendation: row.recommendation, projection: row.projection,
    strengths: row.strengths, weaknesses: row.weaknesses, summary: row.summary,
    document: row.document_path ? {
      url: '/uploads/' + row.document_path, originalName: row.document_original_name,
      mime: row.document_mime, sizeBytes: row.document_size_bytes
    } : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
    player: players.mapPlayer(row, current, history)
  };
}

async function readReport(id, withHistory) {
  const { rows } = await query(REPORT_SQL + ' WHERE r.id = $1', [id]);
  if (!rows[0]) return null;
  const current = await players.statsFor([rows[0].p_id], false);
  const history = withHistory ? await players.statsFor([rows[0].p_id], true) : {};
  return mapReport(rows[0], current[rows[0].p_id], history[rows[0].p_id]);
}

function magicMime(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (path.extname(file.originalname).toLowerCase() || '.bin'))
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!MIME[ext]) cb(http(415, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемый тип файла', [detail('document', 'Допустимы PDF, JPEG, PNG и WebP')]));
    else cb(null, true);
  }
});

function acceptFile(req, res, next) {
  upload.single('document')(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(http(413, 'PAYLOAD_TOO_LARGE', 'Файл слишком большой', [detail('document', 'Больше ' + config.maxUploadMb + ' МБ')]));
      return;
    }
    if (error) { next(error); return; }
    if (!req.file) { next(); return; }
    try {
      const handle = await fs.promises.open(req.file.path, 'r');
      const buffer = Buffer.alloc(16);
      const read = await handle.read(buffer, 0, 16, 0);
      await handle.close();
      const detected = magicMime(buffer.subarray(0, read.bytesRead));
      const expected = MIME[path.extname(req.file.originalname).toLowerCase()];
      if (!detected || detected !== expected) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        next(http(415, 'UNSUPPORTED_MEDIA_TYPE', 'Содержимое файла не совпадает с расширением', [detail('document', 'Файл отклонён')]));
        return;
      }
      req.file.detectedMime = detected;
      next();
    } catch (readError) { next(readError); }
  });
}

async function unlinkStored(filename) {
  if (!filename || path.basename(filename) !== filename) return;
  await fs.promises.unlink(path.join(config.uploadDir, filename)).catch((error) => {
    if (error.code !== 'ENOENT') process.stderr.write('[upload] ' + error.message + '\n');
  });
}

async function save(id, row, file, previousPath) {
  const cols = Object.keys(row);
  if (!cols.length) throw http(400, 'BAD_REQUEST', 'Пустое тело запроса', [detail('body', 'Нет полей для изменения')]);
  try {
    const saved = await tx(async (client) => {
      if (!id) {
        const placeholders = cols.map((_, index) => '$' + (index + 1));
        const inserted = await client.query(
          'INSERT INTO reports (' + cols.join(', ') + ') VALUES (' + placeholders.join(', ') + ') RETURNING id',
          cols.map((col) => row[col])
        );
        return inserted.rows[0].id;
      }
      const sets = cols.map((col, index) => col + ' = $' + (index + 1));
      const updated = await client.query(
        'UPDATE reports SET ' + sets.join(', ') + ' WHERE id = $' + (cols.length + 1) + ' RETURNING id',
        cols.map((col) => row[col]).concat(id)
      );
      return updated.rowCount ? updated.rows[0].id : null;
    });
    if (id && !saved) throw http(404, 'NOT_FOUND', 'Отчёт не найден', [detail('id', 'Отчёт не существует')]);
    if (previousPath && previousPath !== row.document_path) await unlinkStored(previousPath);
    return saved || id;
  } catch (error) {
    if (file) await unlinkStored(file.filename);
    throw error;
  }
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { filters, page, limit } = parseFilters(req.query);
    if (filters.nationId && !(await query('SELECT 1 FROM nations WHERE id = $1', [filters.nationId])).rowCount) {
      throw http(422, 'UNPROCESSABLE_ENTITY', 'Страна не найдена', [detail('nationId', 'Страна не существует')]);
    }
    if (filters.clubId && !(await query('SELECT 1 FROM clubs WHERE id = $1', [filters.clubId])).rowCount) {
      throw http(422, 'UNPROCESSABLE_ENTITY', 'Клуб не найден', [detail('clubId', 'Клуб не существует')]);
    }
    const seasonId = (await players.currentSeasonId()) || 0;
    const parts = [];
    const params = [];
    const add = (sql, value) => { params.push(value); parts.push(sql + '$' + params.length); };
    if (filters.q) add("lower(p.surname || ' ' || p.name) LIKE ", '%' + filters.q.toLowerCase() + '%');
    if (filters.ageMin !== undefined) add("date_part('year', age(p.dob)) >= ", filters.ageMin);
    if (filters.ageMax !== undefined) add("date_part('year', age(p.dob)) <= ", filters.ageMax);
    if (filters.nationId !== undefined) add('p.nation_id = ', filters.nationId);
    if (filters.position) add('p.position = ', filters.position);
    if (filters.clubId !== undefined) add('p.current_club_id = ', filters.clubId);
    if (filters.hand) add('p.hand = ', filters.hand);
    if (filters.isUfa !== undefined) add('p.is_ufa = ', filters.isUfa);
    if (filters.gradeMin !== undefined) add('r.overall_grade >= ', filters.gradeMin);
    if (filters.gradeMax !== undefined) add('r.overall_grade <= ', filters.gradeMax);
    if (filters.recommendation) add('r.recommendation = ', filters.recommendation);
    if (filters.matchesObservedMin !== undefined) add('r.matches_observed >= ', filters.matchesObservedMin);
    if (filters.hasDocument === true) parts.push('r.document_path IS NOT NULL');
    if (filters.hasDocument === false) parts.push('r.document_path IS NULL');
    const statParts = ['css.player_id = p.id'];
    let hasStat = false;
    for (const [name, sql] of Object.entries(STAT)) {
      if (filters[name] === undefined) continue;
      if (!hasStat) {
        params.push(seasonId);
        statParts.push('css.season_id = $' + params.length);
        hasStat = true;
      }
      params.push(filters[name]);
      statParts.push(sql + '$' + params.length);
    }
    if (hasStat) parts.push('EXISTS (SELECT 1 FROM current_season_stats css WHERE ' + statParts.join(' AND ') + ')');
    const where = parts.length ? ' WHERE ' + parts.join(' AND ') : '';
    const from = ' FROM reports r JOIN players p ON p.id = r.player_id';
    const total = (await query('SELECT COUNT(*)::int AS total' + from + where, params)).rows[0].total;
    params.push(seasonId, limit, (page - 1) * limit);
    const seasonPh = '$' + (params.length - 2);
    const listSql = REPORT_SQL + `
      LEFT JOIN LATERAL (
        SELECT goals, assists, points, gp, plus_minus, pim, save_pct, gaa, faceoff_pct
        FROM current_season_stats css WHERE css.player_id = p.id AND css.season_id = ${seasonPh}
        ORDER BY CASE WHEN p.current_club_id IS NOT NULL AND css.club_id = p.current_club_id THEN 0 ELSE 1 END, css.id
        LIMIT 1
      ) css_sort ON TRUE` + where +
      ' ORDER BY ' + SORT[filters.sort] + ' ' + filters.order + ' NULLS LAST, r.id DESC LIMIT $' +
      (params.length - 1) + ' OFFSET $' + params.length;
    const { rows } = await query(listSql, params);
    const current = await players.statsFor([...new Set(rows.map((row) => row.p_id))], false);
    res.json({ items: rows.map((row) => mapReport(row, current[row.p_id], [])), total, page, limit });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const report = await readReport(players.parseId(req.params.id), true);
    if (!report) throw http(404, 'NOT_FOUND', 'Отчёт не найден', [detail('id', 'Отчёт не существует')]);
    res.json(report);
  } catch (error) { next(error); }
});

router.post('/', acceptFile, async (req, res, next) => {
  let stored = false;
  try {
    const { value } = parseBody(req.body, 'create');
    if (!(await players.playerExists(value.playerId))) {
      throw http(422, 'UNPROCESSABLE_ENTITY', 'Игрок не найден', [detail('playerId', 'Игрок не существует')]);
    }
    const id = await save(null, toRow(value, req.file, true), req.file);
    stored = true;
    res.status(201).json(await readReport(id, true));
  } catch (error) {
    if (req.file && !stored) await unlinkStored(req.file.filename);
    next(error);
  }
});

async function change(req, res, next, mode) {
  let stored = false;
  try {
    const id = players.parseId(req.params.id);
    const existing = await query('SELECT document_path FROM reports WHERE id = $1', [id]);
    if (!existing.rowCount) throw http(404, 'NOT_FOUND', 'Отчёт не найден', [detail('id', 'Отчёт не существует')]);
    const parsed = parseBody(req.body, mode);
    if (parsed.value.playerId !== undefined && !(await players.playerExists(parsed.value.playerId))) {
      throw http(422, 'UNPROCESSABLE_ENTITY', 'Игрок не найден', [detail('playerId', 'Игрок не существует')]);
    }
    const full = mode === 'replace';
    const row = toRow(parsed.value, req.file, full);
    if (!req.file && !full && parsed.removeDocument) {
      row.document_path = null; row.document_original_name = null; row.document_mime = null; row.document_size_bytes = null;
    }
    if (!full && !req.file && !parsed.removeDocument && !Object.keys(row).length) {
      throw http(400, 'BAD_REQUEST', 'Пустое тело запроса', [detail('body', 'Нет полей для изменения')]);
    }
    const drops = Boolean(req.file) || full || parsed.removeDocument;
    await save(id, row, req.file, drops ? existing.rows[0].document_path : null);
    stored = true;
    res.json(await readReport(id, true));
  } catch (error) {
    if (req.file && !stored) await unlinkStored(req.file.filename);
    next(error);
  }
}

router.put('/:id', acceptFile, (req, res, next) => change(req, res, next, 'replace'));
router.patch('/:id', acceptFile, (req, res, next) => change(req, res, next, 'patch'));

router.delete('/:id', async (req, res, next) => {
  try {
    const id = players.parseId(req.params.id);
    const removed = await query('DELETE FROM reports WHERE id = $1 RETURNING document_path', [id]);
    if (!removed.rowCount) throw http(404, 'NOT_FOUND', 'Отчёт не найден', [detail('id', 'Отчёт не существует')]);
    await unlinkStored(removed.rows[0].document_path);
    res.json({ ok: true, id });
  } catch (error) { next(error); }
});

module.exports = { router };
