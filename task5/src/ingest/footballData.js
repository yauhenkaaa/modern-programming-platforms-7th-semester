import fs from 'node:fs';
import path from 'node:path';
import { LEAGUES, num } from './normalize.js';

const MAP = { PL: 'E0', PD: 'SP1', BL1: 'D1', SA: 'I1' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pullFootballData({ http, key, rawDir, log }) {
  const cacheFile = path.join(rawDir, 'football-data.json');
  const cached = () => {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return null; }
  };
  if (!key) {
    log.warn('FOOTBALL_DATA_KEY missing, football-data.org falls back to the public competition list or cache');
    const hit = cached();
    if (hit?.leagues?.length) return hit;
    try {
      const json = await http.json('https://api.football-data.org/v4/competitions');
      const out = { leagues: [], teams: [], matches: [] };
      for (const comp of json?.competitions || []) {
        const div = MAP[comp.code];
        if (!div) continue;
        const [name, country] = LEAGUES[div];
        out.leagues.push({ code: div, name, country, source: 'football-data.org' });
      }
      if (out.leagues.length) {
        fs.mkdirSync(rawDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(out));
      }
      log.info({ leagues: out.leagues.length }, 'football-data.org public list');
      return out.leagues.length ? out : (hit || out);
    } catch (error) {
      log.error({ err: error.message }, 'football-data.org public list failed');
      return hit || { leagues: [], teams: [], matches: [] };
    }
  }
  const headers = { 'X-Auth-Token': key };
  const out = { leagues: [], teams: [], matches: [] };
  try {
    let calls = 0;
    for (const [code, div] of Object.entries(MAP)) {
      try {
        if (calls) await sleep(6500);
        calls += 1;
        const teams = await http.json(`https://api.football-data.org/v4/competitions/${code}/teams`, { headers }, { retries: 3, pause: 7000 });
        await sleep(6500);
        calls += 1;
        const matches = await http.json(`https://api.football-data.org/v4/competitions/${code}/matches`, { headers }, { retries: 3, pause: 7000 });
      const [name, country] = LEAGUES[div];
      out.leagues.push({ code: div, name, country, source: 'football-data.org' });
      for (const team of teams?.teams || []) {
        out.teams.push({
          name: team.name,
          country: team.area?.name || country,
          founded: num(team.founded),
          stadiumName: team.venue,
          source: 'football-data.org',
          externalId: team.id ? `fd:${team.id}` : null,
          badge: team.crest || null,
          players: (team.squad || []).filter((player) => player?.name).map((player) => ({
            name: player.name,
            position: player.position || null,
            nationality: player.nationality || null,
            birth: player.dateOfBirth ? String(player.dateOfBirth).slice(0, 10) : null,
            source: 'football-data.org',
          })),
        });
      }
      for (const match of matches?.matches || []) {
        const date = String(match.utcDate || '').slice(0, 10);
        if (!date || !match.homeTeam?.name || !match.awayTeam?.name) continue;
        out.matches.push({
          code: div,
          date,
          status: mapStatus(match.status),
          home: match.homeTeam.name,
          away: match.awayTeam.name,
          hg: num(match.score?.fullTime?.home),
          ag: num(match.score?.fullTime?.away),
          source: 'football-data.org',
          externalId: match.id || null,
          referee: (match.referees || []).find((ref) => ref.type === 'REFEREE')?.name || match.referees?.[0]?.name || null,
          venue: typeof match.venue === 'string' ? match.venue : match.venue?.name || null,
          htH: num(match.score?.halfTime?.home),
          htA: num(match.score?.halfTime?.away),
          events: protocol(match),
        });
      }
      } catch (error) {
        log.warn({ code, err: error.message }, 'football-data.org competition skipped');
      }
    }
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out));
    const protocolEvents = out.matches.reduce((sum, row) => sum + (row.events?.length || 0), 0);
    log.info({ teams: out.teams.length, matches: out.matches.length, protocolEvents }, 'football-data.org');
    return out;
  } catch (error) {
    log.error({ err: error.message }, 'football-data.org failed, using cache');
    return cached() || { leagues: [], teams: [], matches: [] };
  }
}

function person(value) {
  return value?.name || value?.shortName || '';
}

function protocol(match) {
  const events = [];
  for (const goal of match.goals || []) {
    const assist = person(goal.assist);
    events.push({
      minute: num(goal.minute),
      type: goal.type === 'OWN' ? 'OWN_GOAL' : 'GOAL',
      team: goal.team?.name || null,
      player: person(goal.scorer),
      detail: assist ? `пас ${assist}` : (goal.type || null),
    });
  }
  for (const card of match.bookings || []) {
    const red = card.card === 'RED' || card.card === 'RED_CARD' || card.card === 'YELLOW_RED';
    events.push({
      minute: num(card.minute),
      type: red ? 'RED' : 'YELLOW',
      team: card.team?.name || null,
      player: person(card.player),
      detail: card.card || null,
    });
  }
  for (const sub of match.substitutions || []) {
    const outName = person(sub.playerOut);
    events.push({
      minute: num(sub.minute),
      type: 'SUB',
      team: sub.team?.name || null,
      player: person(sub.playerIn),
      detail: outName ? `вместо ${outName}` : null,
    });
  }
  return events;
}

function mapStatus(status) {
  if (status === 'IN_PLAY' || status === 'PAUSED') return 'LIVE';
  if (status === 'TIMED' || status === 'SCHEDULED') return 'SCHEDULED';
  return status || 'SCHEDULED';
}
