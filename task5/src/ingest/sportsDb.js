import fs from 'node:fs';
import path from 'node:path';
import { num } from './normalize.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LEAGUE_NAMES = [
  'English Premier League',
  'English League Championship',
  'Spanish La Liga',
  'German Bundesliga',
  'Italian Serie A',
  'French Ligue 1',
];

export async function pullSportsDb({ http, key, rawDir, log }) {
  const cacheFile = path.join(rawDir, 'thesportsdb.json');
  const read = () => {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return null; }
  };
  const out = { teams: [], players: [], stadiums: [] };
  try {
    const base = `https://www.thesportsdb.com/api/v1/json/${key}`;
    let first = true;
    for (const league of LEAGUE_NAMES) {
      if (!first) await sleep(2100);
      first = false;
      const json = await http.json(`${base}/search_all_teams.php?l=${encodeURIComponent(league)}`, {}, { retries: 2, pause: 2000 });
      for (const team of json?.teams || []) collectTeam(out, team);
    }
    await sleep(2100);
    const arsenal = await http.json(`${base}/searchteams.php?t=Arsenal`, {}, { retries: 2, pause: 2000 });
    for (const team of arsenal?.teams || []) collectTeam(out, team);
    await sleep(2100);
    const venues = await http.json(`${base}/searchvenues.php?v=Wembley`, {}, { retries: 2, pause: 2000 });
    for (const venue of venues?.venues || []) {
      out.stadiums.push({
        name: venue.strVenue,
        city: venue.strLocation || null,
        country: venue.strCountry || null,
        capacity: num(venue.intCapacity),
        source: 'thesportsdb',
      });
    }
    const sample = out.teams.filter((team) => team.externalId).slice(0, 2);
    for (const team of sample) {
      await sleep(2100);
      const players = await http.json(`${base}/lookup_all_players.php?id=${team.externalId}`, {}, { retries: 2, pause: 2000 });
      for (const player of players?.player || []) {
        out.players.push({
          teamName: player.strTeam || team.name,
          name: player.strPlayer,
          position: player.strPosition || null,
          nationality: player.strNationality || null,
          birth: player.dateBorn || null,
          source: 'thesportsdb',
        });
      }
    }
    if (!out.teams.length && !out.stadiums.length) throw new Error('empty sportsdb payload');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out));
    log.info({ teams: out.teams.length, players: out.players.length, stadiums: out.stadiums.length }, 'thesportsdb');
    return out;
  } catch (error) {
    log.error({ err: error.message }, 'thesportsdb failed, using cache');
    return read() || out;
  }
}

function youtubeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  return `https://www.youtube.com/${text.replace(/^\//, '')}`;
}

function collectTeam(out, team) {
  if (!team?.strTeam) return;
  out.teams.push({
    name: team.strTeam,
    country: team.strCountry || null,
    founded: num(team.intFormedYear),
    stadiumName: team.strStadium || null,
    stadiumCity: team.strStadiumLocation || null,
    stadiumCapacity: num(team.intStadiumCapacity),
    source: 'thesportsdb',
    externalId: team.idTeam || null,
    badge: team.strBadge || team.strLogo || null,
    youtube: youtubeUrl(team.strYoutube),
  });
  if (team.strStadium) {
    out.stadiums.push({
      name: team.strStadium,
      city: team.strStadiumLocation || null,
      country: team.strCountry || null,
      capacity: num(team.intStadiumCapacity),
      source: 'thesportsdb',
    });
  }
}
