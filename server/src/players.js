'use strict';

const express = require('express');
const { query, http } = require('./db');

const POSITIONS = ['вратарь', 'защитник', 'нападающий'];
const HANDS = ['левый', 'правый'];
const RECOMMENDATIONS = ['sign', 'monitor', 'pass'];

const PLAYER_SQL = `
  SELECT p.id AS p_id, p.name AS p_name, p.patronymic AS p_patronymic, p.surname AS p_surname,
    p.dob AS p_dob, date_part('year', age(p.dob))::int AS p_age, p.position AS p_position,
    p.hand AS p_hand, p.jersey_number AS p_jersey_number, p.height_cm AS p_height_cm,
    p.weight_kg AS p_weight_kg, p.photo AS p_photo, p.bio AS p_bio, p.is_ufa AS p_is_ufa,
    p.contract_until AS p_contract_until, n.id AS n_id, n.nation_name AS n_name,
    n.iso_code AS n_iso, n.flag_url AS n_flag, c.id AS c_id, c.name AS c_name, c.city AS c_city,
    c.logo AS c_logo, c.arena AS c_arena, c.bio AS c_bio, c.division AS c_division, c.conference AS c_conference
  FROM players p
  JOIN nations n ON n.id = p.nation_id
  LEFT JOIN clubs c ON c.id = p.current_club_id`;

function clubOf(row, prefix) {
  const id = row[prefix + 'id'];
  if (id == null) return null;
  return {
    id, name: row[prefix + 'name'], city: row[prefix + 'city'], logo: row[prefix + 'logo'],
    arena: row[prefix + 'arena'], bio: row[prefix + 'bio'], division: row[prefix + 'division'],
    conference: row[prefix + 'conference']
  };
}

function mapStat(row) {
  return {
    id: row.id,
    season: { id: row.season_id, title: row.season_title, startYear: row.start_year, endYear: row.end_year },
    club: clubOf(row, 'club_'),
    stage: row.stage, bio: row.season_bio, gp: row.gp, goals: row.goals, assists: row.assists,
    points: row.points, plusMinus: row.plus_minus, pim: row.pim, sog: row.sog,
    shootingPct: row.shooting_pct, faceoffs: row.faceoffs, faceoffsWon: row.faceoffs_won,
    faceoffPct: row.faceoff_pct, toiSeconds: row.toi_seconds, ppg: row.ppg, shg: row.shg,
    gwg: row.gwg, esg: row.esg, gaa: row.gaa, savePct: row.save_pct, saves: row.saves,
    shotsAgainst: row.shots_against, shutouts: row.shutouts, wins: row.wins, losses: row.losses,
    otLosses: row.ot_losses, extraStats: row.extra_stats || {}
  };
}

function mapPlayer(row, current, history) {
  return {
    id: row.p_id, name: row.p_name, patronymic: row.p_patronymic, surname: row.p_surname,
    fullName: row.p_surname + ' ' + row.p_name, dob: row.p_dob, age: row.p_age,
    position: row.p_position, hand: row.p_hand, jerseyNumber: row.p_jersey_number,
    heightCm: row.p_height_cm, weightKg: row.p_weight_kg, photo: row.p_photo, bio: row.p_bio,
    isUfa: row.p_is_ufa, contractUntil: row.p_contract_until,
    nation: row.n_id ? { id: row.n_id, name: row.n_name, isoCode: row.n_iso ? String(row.n_iso).trim() : null, flagUrl: row.n_flag } : null,
    club: clubOf(row, 'c_'),
    currentSeasonStats: current || [],
    seasonHistory: history || []
  };
}

async function statsFor(ids, history) {
  const grouped = {};
  if (!ids.length) return grouped;
  const table = history ? 'all_time_stats' : 'current_season_stats';
  const extra = history ? 's.stage, s.bio AS season_bio' : 'NULL::text AS stage, NULL::text AS season_bio';
  const order = history ? "se.start_year DESC, CASE s.stage WHEN 'regular' THEN 0 ELSE 1 END, s.id" : 's.id';
  const { rows } = await query(
    `SELECT s.id, s.player_id, ${extra}, s.gp, s.goals, s.assists, s.points, s.plus_minus, s.pim,
      s.sog, s.shooting_pct, s.faceoffs, s.faceoffs_won, s.faceoff_pct, s.toi_seconds, s.ppg, s.shg,
      s.gwg, s.esg, s.gaa, s.save_pct, s.saves, s.shots_against, s.shutouts, s.wins, s.losses,
      s.ot_losses, s.extra_stats, se.id AS season_id, se.title AS season_title, se.start_year, se.end_year,
      c.id AS club_id, c.name AS club_name, c.city AS club_city, c.logo AS club_logo, c.arena AS club_arena,
      c.bio AS club_bio, c.division AS club_division, c.conference AS club_conference
     FROM ${table} s JOIN seasons se ON se.id = s.season_id JOIN clubs c ON c.id = s.club_id
     WHERE s.player_id = ANY($1) ORDER BY s.player_id, ${order}`,
    [ids]
  );
  for (const row of rows) (grouped[row.player_id] ||= []).push(mapStat(row));
  return grouped;
}

function parseId(raw) {
  if (!/^[1-9]\d*$/.test(String(raw))) {
    throw http(400, 'BAD_REQUEST', 'Идентификатор должен быть целым числом', [{ field: 'id', message: 'Ожидается целое число ≥ 1' }]);
  }
  return Number(raw);
}

async function playerExists(id) {
  const found = await query('SELECT 1 FROM players WHERE id = $1', [id]);
  return found.rowCount > 0;
}

async function currentSeasonId() {
  const { rows } = await query(
    `SELECT s.id FROM seasons s
     WHERE EXISTS (SELECT 1 FROM current_season_stats css WHERE css.season_id = s.id)
     ORDER BY s.end_year DESC, s.id DESC LIMIT 1`
  );
  return rows[0] ? rows[0].id : null;
}

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.includes('\0') || q.length > 120) {
      throw http(400, 'BAD_REQUEST', 'Некорректный поиск', [{ field: 'q', message: 'Строка пустая по смыслу или длиннее 120 символов' }]);
    }
    const limit = req.query.limit === undefined || req.query.limit === '' ? 10 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw http(400, 'BAD_REQUEST', 'Некорректный limit', [{ field: 'limit', message: 'limit от 1 до 20' }]);
    }
    const params = [];
    let where = '';
    if (q) {
      params.push('%' + q.toLowerCase() + '%');
      where = " WHERE lower(p.surname || ' ' || p.name) LIKE $1";
    }
    params.push(limit);
    const { rows } = await query(PLAYER_SQL + where + ' ORDER BY p.surname, p.name, p.id LIMIT $' + params.length, params);
    res.json({
      items: rows.map((row) => ({
        id: row.p_id, name: row.p_name, patronymic: row.p_patronymic, surname: row.p_surname,
        fullName: row.p_surname + ' ' + row.p_name, position: row.p_position,
        jerseyNumber: row.p_jersey_number, photo: row.p_photo, club: clubOf(row, 'c_')
      }))
    });
  } catch (error) { next(error); }
});

router.get('/leaders', async (_req, res, next) => {
  try {
    const seasonId = await currentSeasonId();
    if (!seasonId) return res.json({ points: [], defensemen: [], savePct: [] });
    async function top(extra, column) {
      const { rows } = await query(
        `SELECT p.id, p.surname, p.name, c.name AS club, MAX(s.${column}) AS value
         FROM current_season_stats s JOIN players p ON p.id = s.player_id
         LEFT JOIN clubs c ON c.id = p.current_club_id
         WHERE s.season_id = $1 ${extra}
         GROUP BY p.id, p.surname, p.name, c.name
         ORDER BY value DESC NULLS LAST, p.id LIMIT 5`,
        [seasonId]
      );
      return rows.map((row) => ({ id: row.id, fullName: row.surname + ' ' + row.name, club: row.club, value: Number(row.value) }));
    }
    res.json({
      points: await top('', 'points'),
      defensemen: await top("AND p.position = 'защитник'", 'points'),
      savePct: await top('AND s.save_pct IS NOT NULL', 'save_pct')
    });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const { rows } = await query(PLAYER_SQL + ' WHERE p.id = $1', [id]);
    if (!rows[0]) throw http(404, 'NOT_FOUND', 'Игрок не найден', [{ field: 'id', message: 'Игрок не существует' }]);
    const current = await statsFor([id], false);
    const history = await statsFor([id], true);
    res.json(mapPlayer(rows[0], current[id], history[id]));
  } catch (error) { next(error); }
});

async function dictionaries(_req, res, next) {
  try {
    const [clubs, nations, seasons, current] = await Promise.all([
      query('SELECT id, name, city, logo, arena, bio, division, conference FROM clubs ORDER BY name, id'),
      query('SELECT id, nation_name, iso_code, flag_url FROM nations ORDER BY nation_name, id'),
      query('SELECT id, title, start_year, end_year FROM seasons ORDER BY start_year, id'),
      query(`SELECT s.id, s.title, s.start_year, s.end_year FROM seasons s
        WHERE EXISTS (SELECT 1 FROM current_season_stats css WHERE css.season_id = s.id)
        ORDER BY s.end_year DESC LIMIT 1`)
    ]);
    const season = (row) => (row ? { id: row.id, title: row.title, startYear: row.start_year, endYear: row.end_year } : null);
    res.json({
      clubs: clubs.rows,
      nations: nations.rows.map((row) => ({ id: row.id, name: row.nation_name, isoCode: String(row.iso_code).trim(), flagUrl: row.flag_url })),
      seasons: seasons.rows.map(season),
      currentSeason: season(current.rows[0]),
      positions: POSITIONS, hands: HANDS, stages: ['regular', 'playoff'], recommendation: RECOMMENDATIONS,
      divisions: ['Боброва', 'Тарасова', 'Харламова', 'Чернышёва'],
      conferences: ['Запад', 'Восток'],
      documentMimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    });
  } catch (error) { next(error); }
}

module.exports = { router, dictionaries, mapPlayer, statsFor, playerExists, currentSeasonId, parseId, PLAYER_SQL, clubOf, POSITIONS, HANDS, RECOMMENDATIONS };
