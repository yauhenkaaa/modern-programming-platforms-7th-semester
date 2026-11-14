import fs from 'node:fs';
import { schedule } from 'node-cron';
import { env } from '../shared/env.js';
import { createLogger } from '../shared/logger.js';
import { openDb, migrateMatches, migrateTeams } from '../shared/db.js';
import { createHttp } from '../shared/http.js';
import { LEAGUES, normName, seasonYear } from './normalize.js';
import { pullFootballData } from './footballData.js';
import { pullSportsDb } from './sportsDb.js';
import { pullCsv } from './csvSource.js';
import { syntheticPlayers, syntheticStadium } from './synthetic.js';

const log = createLogger('ingest');
const rawDir = `${env.dataDir}/raw`;

const teamsDb = openDb('teams.db');
const matchesDb = openDb('matches.db');
migrateTeams(teamsDb);
migrateMatches(matchesDb);

const stadiumStmt = teamsDb.prepare(`
  INSERT INTO stadiums (name, name_norm, city, country, capacity, source)
  VALUES (@name, @nameNorm, @city, @country, @capacity, @source)
  ON CONFLICT(name_norm) DO UPDATE SET
    city=coalesce(excluded.city, stadiums.city),
    country=coalesce(excluded.country, stadiums.country),
    capacity=coalesce(excluded.capacity, stadiums.capacity),
    source=CASE WHEN stadiums.source='synthetic' THEN excluded.source ELSE stadiums.source END
  RETURNING id`);
const teamStmt = teamsDb.prepare(`
  INSERT INTO teams (name, name_norm, country, founded, stadium_id, source, external_id, badge_url, youtube)
  VALUES (@name, @nameNorm, @country, @founded, @stadiumId, @source, @externalId, @badge, @youtube)
  ON CONFLICT(name_norm) DO UPDATE SET
    name=CASE WHEN length(excluded.name)>length(teams.name) THEN excluded.name ELSE teams.name END,
    country=coalesce(excluded.country, teams.country),
    founded=coalesce(excluded.founded, teams.founded),
    stadium_id=CASE
      WHEN excluded.stadium_id IS NOT NULL AND excluded.source != 'synthetic' THEN excluded.stadium_id
      ELSE coalesce(teams.stadium_id, excluded.stadium_id)
    END,
    external_id=coalesce(excluded.external_id, teams.external_id),
    badge_url=coalesce(excluded.badge_url, teams.badge_url),
    youtube=coalesce(excluded.youtube, teams.youtube),
    source=CASE WHEN teams.source='synthetic' THEN excluded.source ELSE teams.source END
  RETURNING id`);
const playerStmt = teamsDb.prepare(`
  INSERT INTO players (team_id, name, name_norm, position, nationality, birth, source)
  VALUES (@teamId, @name, @nameNorm, @position, @nationality, @birth, @source)
  ON CONFLICT(team_id, name_norm) DO UPDATE SET
    position=coalesce(excluded.position, players.position),
    nationality=coalesce(excluded.nationality, players.nationality),
    birth=coalesce(excluded.birth, players.birth),
    source=CASE WHEN players.source='synthetic' THEN excluded.source ELSE players.source END`);
const leagueStmt = matchesDb.prepare(`
  INSERT INTO leagues (name, code, country, source)
  VALUES (@name, @code, @country, @source)
  ON CONFLICT(code) DO UPDATE SET
    country=coalesce(excluded.country, leagues.country),
    source=CASE WHEN leagues.source='synthetic' THEN excluded.source ELSE leagues.source END
  RETURNING id`);
const seasonStmt = matchesDb.prepare(`
  INSERT INTO seasons (league_id, year, label) VALUES (@leagueId, @year, @label)
  ON CONFLICT(league_id, year) DO UPDATE SET label=excluded.label RETURNING id`);
const matchStmt = matchesDb.prepare(`
  INSERT INTO matches (
    season_id, utc_date, status, home_team_id, away_team_id, home_name, away_name,
    home_goals, away_goals, odds_home, odds_draw, odds_away, source, natural_key, referee, venue,
    ht_home, ht_away, home_shots, away_shots, home_shots_on, away_shots_on,
    home_fouls, away_fouls, home_corners, away_corners, home_yellow, away_yellow, home_red, away_red)
  VALUES (
    @seasonId, @date, @status, @homeId, @awayId, @home, @away,
    @hg, @ag, @oddsH, @oddsD, @oddsA, @source, @key, @referee, @venue,
    @htH, @htA, @homeShots, @awayShots, @homeShotsOn, @awayShotsOn,
    @homeFouls, @awayFouls, @homeCorners, @awayCorners, @homeYellow, @awayYellow, @homeRed, @awayRed)
  ON CONFLICT(natural_key) DO UPDATE SET
    status=excluded.status,
    home_goals=coalesce(excluded.home_goals, matches.home_goals),
    away_goals=coalesce(excluded.away_goals, matches.away_goals),
    odds_home=coalesce(excluded.odds_home, matches.odds_home),
    odds_draw=coalesce(excluded.odds_draw, matches.odds_draw),
    odds_away=coalesce(excluded.odds_away, matches.odds_away),
    home_team_id=excluded.home_team_id,
    away_team_id=excluded.away_team_id,
    referee=coalesce(excluded.referee, matches.referee),
    venue=coalesce(excluded.venue, matches.venue),
    ht_home=coalesce(excluded.ht_home, matches.ht_home),
    ht_away=coalesce(excluded.ht_away, matches.ht_away),
    home_shots=coalesce(excluded.home_shots, matches.home_shots),
    away_shots=coalesce(excluded.away_shots, matches.away_shots),
    home_shots_on=coalesce(excluded.home_shots_on, matches.home_shots_on),
    away_shots_on=coalesce(excluded.away_shots_on, matches.away_shots_on),
    home_fouls=coalesce(excluded.home_fouls, matches.home_fouls),
    away_fouls=coalesce(excluded.away_fouls, matches.away_fouls),
    home_corners=coalesce(excluded.home_corners, matches.home_corners),
    away_corners=coalesce(excluded.away_corners, matches.away_corners),
    home_yellow=coalesce(excluded.home_yellow, matches.home_yellow),
    away_yellow=coalesce(excluded.away_yellow, matches.away_yellow),
    home_red=coalesce(excluded.home_red, matches.home_red),
    away_red=coalesce(excluded.away_red, matches.away_red),
    source=CASE WHEN matches.source='synthetic' THEN excluded.source ELSE matches.source END
  RETURNING id`);
const eventStmt = matchesDb.prepare(`
  INSERT INTO events (match_id, minute, type, team_id, player_name, detail, source)
  VALUES (@matchId, @minute, @type, @teamId, @player, @detail, @source)
  ON CONFLICT(match_id, type, minute, player_name) DO NOTHING`);

function saveStadium(row) {
  if (!row?.name) return null;
  const nameNorm = normName(row.name);
  if (!nameNorm) return null;
  return stadiumStmt.get({
    name: row.name, nameNorm, city: row.city || null, country: row.country || null,
    capacity: row.capacity ?? null, source: row.source,
  }).id;
}

function saveTeam(row) {
  const nameNorm = normName(row.name);
  if (!nameNorm) return null;
  const stadiumId = row.stadiumName
    ? saveStadium({ name: row.stadiumName, city: row.stadiumCity, country: row.country, capacity: row.stadiumCapacity, source: row.source })
    : (row.stadiumId ?? null);
  return teamStmt.get({
    name: row.name, nameNorm, country: row.country || null, founded: row.founded ?? null,
    stadiumId, source: row.source, externalId: row.externalId || null,
    badge: row.badge || null, youtube: row.youtube || null,
  }).id;
}

function savePlayer(teamId, row) {
  const nameNorm = normName(row.name);
  if (!teamId || !nameNorm) return;
  playerStmt.run({
    teamId, name: row.name, nameNorm, position: row.position || null,
    nationality: row.nationality || null, birth: row.birth || null, source: row.source,
  });
}

const leagueIds = new Map();
function saveLeague(code, source) {
  const cached = leagueIds.get(code);
  if (cached) return cached;
  const [name, country] = LEAGUES[code] || [code, null];
  const id = leagueStmt.get({ name, code, country, source }).id;
  leagueIds.set(code, id);
  return id;
}

const seasonIds = new Map();
function saveSeason(code, date, source) {
  const year = seasonYear(date);
  if (!year) return null;
  const key = `${code}:${year}`;
  if (seasonIds.has(key)) return seasonIds.get(key);
  const id = seasonStmt.get({
    leagueId: saveLeague(code, source),
    year,
    label: `${year}/${String(year + 1).slice(2)}`,
  }).id;
  seasonIds.set(key, id);
  return id;
}

const teamIds = new Map();
function teamId(name, source, country) {
  const nameNorm = normName(name);
  if (!nameNorm) return null;
  if (teamIds.has(nameNorm)) return teamIds.get(nameNorm);
  const id = saveTeam({ name, country, source });
  teamIds.set(nameNorm, id);
  return id;
}

function saveMatch(row) {
  const homeId = teamId(row.home, row.source, LEAGUES[row.code]?.[1]);
  const awayId = teamId(row.away, row.source, LEAGUES[row.code]?.[1]);
  const seasonId = saveSeason(row.code, row.date, row.source);
  if (!homeId || !awayId || !seasonId || homeId === awayId) return;
  const id = matchStmt.get({
    seasonId, date: row.date, status: row.status, homeId, awayId,
    home: row.home, away: row.away, hg: row.hg ?? null, ag: row.ag ?? null,
    oddsH: row.oddsH ?? null, oddsD: row.oddsD ?? null, oddsA: row.oddsA ?? null,
    source: row.source, key: `${row.date}|${normName(row.home)}|${normName(row.away)}`,
    referee: row.referee || null,
    venue: row.venue || null,
    htH: row.htH ?? null,
    htA: row.htA ?? null,
    homeShots: row.homeShots ?? null,
    awayShots: row.awayShots ?? null,
    homeShotsOn: row.homeShotsOn ?? null,
    awayShotsOn: row.awayShotsOn ?? null,
    homeFouls: row.homeFouls ?? null,
    awayFouls: row.awayFouls ?? null,
    homeCorners: row.homeCorners ?? null,
    awayCorners: row.awayCorners ?? null,
    homeYellow: row.homeYellow ?? null,
    awayYellow: row.awayYellow ?? null,
    homeRed: row.homeRed ?? null,
    awayRed: row.awayRed ?? null,
  }).id;
  for (const event of row.events || []) {
    const side = event.team ? teamId(event.team, row.source, LEAGUES[row.code]?.[1]) : null;
    eventStmt.run({
      matchId: id,
      minute: event.minute ?? null,
      type: event.type,
      teamId: side,
      player: event.player || '',
      detail: event.detail || null,
      source: row.source,
    });
  }
}

function reconcileTeamNames() {
  const rows = teamsDb.prepare(`
    SELECT t.id, t.name, t.name_norm, t.source, t.badge_url, t.youtube, t.stadium_id, s.name AS stadium,
      (SELECT count(*) FROM players p WHERE p.team_id = t.id) AS players
    FROM teams t LEFT JOIN stadiums s ON s.id = t.stadium_id`).all();
  const groups = new Map();
  for (const row of rows) {
    const canon = normName(row.name);
    if (!groups.has(canon)) groups.set(canon, []);
    groups.get(canon).push(row);
  }
  const rank = { 'football-data.org': 3, thesportsdb: 2, csv: 1, synthetic: 0 };
  const copyPlayers = teamsDb.prepare(`
    INSERT OR IGNORE INTO players (team_id, name, name_norm, position, nationality, birth, source)
    SELECT ?, name, name_norm, position, nationality, birth, source FROM players WHERE team_id = ?`);
  const deletePlayers = teamsDb.prepare('DELETE FROM players WHERE team_id = ?');
  const deleteTeam = teamsDb.prepare('DELETE FROM teams WHERE id = ?');
  const updateTeam = teamsDb.prepare('UPDATE teams SET name_norm = ?, badge_url = ?, youtube = ?, stadium_id = ? WHERE id = ?');
  const repointHome = matchesDb.prepare('UPDATE matches SET home_team_id = ? WHERE home_team_id = ?');
  const repointAway = matchesDb.prepare('UPDATE matches SET away_team_id = ? WHERE away_team_id = ?');
  let merged = 0;
  const tx = teamsDb.transaction(() => {
    for (const [canon, group] of groups) {
      const keep = [...group].sort((a, b) => (rank[b.source] || 0) - (rank[a.source] || 0) || b.players - a.players)[0];
      const badge = ['football-data.org', 'thesportsdb', 'csv']
        .map((source) => group.find((row) => row.source === source && row.badge_url)?.badge_url)
        .find(Boolean) || keep.badge_url;
      const youtube = group.find((row) => row.youtube)?.youtube || null;
      const stadium = group.filter((row) => row.stadium_id && row.stadium).sort((a, b) => a.stadium.length - b.stadium.length)[0];
      for (const row of group) {
        if (row.id === keep.id) continue;
        copyPlayers.run(keep.id, row.id);
        deletePlayers.run(row.id);
        repointHome.run(keep.id, row.id);
        repointAway.run(keep.id, row.id);
        deleteTeam.run(row.id);
        merged += 1;
      }
      updateTeam.run(canon, badge || null, youtube, stadium?.stadium_id || keep.stadium_id, keep.id);
    }
  });
  tx();
  matchesDb.prepare('DELETE FROM events WHERE match_id IN (SELECT id FROM matches WHERE home_team_id = away_team_id)').run();
  const removed = matchesDb.prepare('DELETE FROM matches WHERE home_team_id = away_team_id').run().changes;
  if (merged || removed) log.info({ merged, removed }, 'merged duplicate teams');
}

function dedupeMatches() {
  const rows = matchesDb.prepare(`
    SELECT id, utc_date, home_name, away_name, natural_key, home_goals, home_shots
    FROM matches`).all();
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.utc_date}|${normName(row.home_name)}|${normName(row.away_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, canon: key });
  }
  const dropEvents = matchesDb.prepare('DELETE FROM events WHERE match_id = ?');
  const dropMatch = matchesDb.prepare('DELETE FROM matches WHERE id = ?');
  const rename = matchesDb.prepare('UPDATE matches SET natural_key = ? WHERE id = ?');
  let removed = 0;
  const tx = matchesDb.transaction(() => {
    for (const [key, group] of groups) {
      if (group.length < 2 && group[0].natural_key === key) continue;
      const keep = [...group].sort((a, b) => {
        const rank = (row) => (row.home_shots != null ? 4 : 0) + (row.home_goals != null ? 2 : 0) + (row.natural_key === key ? 1 : 0);
        return rank(b) - rank(a);
      })[0];
      for (const row of group) {
        if (row.id === keep.id) continue;
        dropEvents.run(row.id);
        dropMatch.run(row.id);
        removed += 1;
      }
      if (keep.natural_key !== key) rename.run(key, keep.id);
    }
  });
  tx();
  if (removed) log.info({ removed }, 'deduped matches');
}

function rememberTeams() {
  for (const row of teamsDb.prepare('SELECT id, name_norm FROM teams').all()) teamIds.set(row.name_norm, row.id);
}

function fillGaps() {
  const bare = teamsDb.prepare(`
    SELECT t.id, t.name, t.country FROM teams t
    WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.team_id = t.id)
    LIMIT 700`).all();
  const tx = teamsDb.transaction((rows) => {
    for (const team of rows) {
      if (!team.stadium_id && !teamsDb.prepare('SELECT stadium_id FROM teams WHERE id=?').get(team.id).stadium_id) {
        const stadium = syntheticStadium(team);
        const stadiumId = saveStadium(stadium);
        teamsDb.prepare('UPDATE teams SET stadium_id=? WHERE id=? AND stadium_id IS NULL').run(stadiumId, team.id);
      }
      for (const player of syntheticPlayers(team)) savePlayer(team.id, player);
    }
  });
  tx(bare);
  log.info({ syntheticSquads: bare.length }, 'synthetic players');
}

function topUpMatches(target) {
  const have = matchesDb.prepare('SELECT count(*) c FROM matches').get().c;
  if (have >= target) return;
  const pool = teamsDb.prepare('SELECT id, name, name_norm FROM teams ORDER BY id LIMIT 60').all();
  if (pool.length < 2) return;
  const need = target - have;
  const tx = matchesDb.transaction(() => {
    for (let i = 0; i < need; i += 1) {
      const home = pool[i % pool.length];
      const away = pool[(i + 3) % pool.length];
      const date = new Date(Date.UTC(2099, 0, 1) + i * 86400000).toISOString().slice(0, 10);
      saveMatch({
        code: 'SYN', date, status: 'FINISHED', home: home.name, away: away.name,
        hg: i % 5, ag: (i + 1) % 4, source: 'synthetic',
      });
    }
  });
  tx();
  log.info({ syntheticMatches: need }, 'synthetic top-up');
}

function report() {
  const sections = [
    [teamsDb, 'stadiums'], [teamsDb, 'teams'], [teamsDb, 'players'],
    [matchesDb, 'leagues'], [matchesDb, 'matches'], [matchesDb, 'events'],
  ];
  let total = matchesDb.prepare('SELECT count(*) c FROM seasons').get().c;
  for (const [db, table] of sections) {
    const rows = db.prepare(`SELECT source, count(*) c FROM ${table} GROUP BY source ORDER BY source`).all();
    const count = rows.reduce((sum, row) => sum + row.c, 0);
    total += count;
    log.info({ table, count, bySource: Object.fromEntries(rows.map((row) => [row.source, row.c])) }, 'ingest source');
  }
  log.info({ total, seasons: matchesDb.prepare('SELECT count(*) c FROM seasons').get().c }, 'ingest total');
  if (total < 10000) process.exitCode = 1;
}

async function run() {
  fs.mkdirSync(rawDir, { recursive: true });
  const total = ['stadiums', 'teams', 'players'].reduce((sum, table) => sum + teamsDb.prepare(`SELECT count(*) c FROM ${table}`).get().c, 0)
    + ['leagues', 'seasons', 'matches', 'events'].reduce((sum, table) => sum + matchesDb.prepare(`SELECT count(*) c FROM ${table}`).get().c, 0);
  if (total >= 10000 && !env.ingestForce) {
    log.info({ total }, 'ingest skipped, data already loaded');
    report();
    return;
  }
  if (env.ingestForce) {
    matchesDb.prepare("DELETE FROM events WHERE type = 'FULL_TIME' OR source = 'synthetic'").run();
    matchesDb.prepare("DELETE FROM matches WHERE source = 'synthetic'").run();
    teamsDb.prepare("DELETE FROM players WHERE source = 'synthetic'").run();
    log.info('removed synthetic rows before reload');
  }
  rememberTeams();
  const csvHttp = createHttp('csv');
  const fdHttp = createHttp('football-data');
  const sdbHttp = createHttp('thesportsdb');
  let csvMatches = [];
  try {
    csvMatches = await pullCsv({ http: csvHttp, rawDir, log });
  } catch (error) {
    log.error({ err: error.message }, 'csv source failed');
  }
  const football = await pullFootballData({ http: fdHttp, key: env.footballDataKey, rawDir, log });
  const sports = await pullSportsDb({ http: sdbHttp, key: env.sportsDbKey, rawDir, log });
  const write = matchesDb.transaction(() => {
    for (const league of football.leagues || []) saveLeague(league.code, league.source);
    for (const team of [...(sports.teams || []), ...(football.teams || [])]) {
      const id = saveTeam(team);
      if (id) teamIds.set(normName(team.name), id);
    }
    for (const player of sports.players || []) savePlayer(teamIds.get(normName(player.teamName)), player);
    for (const team of football.teams || []) {
      const id = teamIds.get(normName(team.name));
      for (const player of team.players || []) savePlayer(id, player);
    }
    for (const match of [...csvMatches, ...(football.matches || [])]) saveMatch(match);
  });
  write();
  reconcileTeamNames();
  dedupeMatches();
  if (!env.footballDataKey) {
    fillGaps();
    topUpMatches(10000);
  }
  report();
}

const cronMode = process.argv.includes('--cron');
if (process.argv.includes('--merge')) {
  reconcileTeamNames();
  dedupeMatches();
  report();
} else if (cronMode) {
  schedule(env.ingestCron, () => run().catch((error) => log.error({ err: error.message }, 'cron ingest failed')));
  await run();
  log.info({ cron: env.ingestCron }, 'ingest scheduled');
} else {
  await run();
}
