import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { LEAGUES, num, parseCsvDate } from './normalize.js';

const SEASONS = ['2526', '2425', '2324', '2223', '2122', '2021', '1920', '1819', '1718', '1617'];
const DIVS = Object.keys(LEAGUES).filter((code) => code !== 'SYN');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pullCsv({ http, rawDir, log, target = 10000 }) {
  const dir = path.join(rawDir, 'csv');
  fs.mkdirSync(dir, { recursive: true });
  const matches = [];
  for (const season of SEASONS) {
    for (const div of DIVS) {
      const file = path.join(dir, `${season}-${div}.csv`);
      let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (!text) {
        const url = `https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`;
        text = await http.text(url, {}, { retries: 2, pause: 400 });
        await sleep(150);
        if (!text || !text.includes('HomeTeam')) {
          log.warn({ season, div }, 'csv unavailable');
          continue;
        }
        fs.writeFileSync(file, text);
      }
      if (!text.includes('HomeTeam')) continue;
      let rows = [];
      try {
        rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
      } catch (error) {
        log.warn({ season, div, err: error.message }, 'csv parse failed');
        continue;
      }
      for (const row of rows) {
        const date = parseCsvDate(row.Date);
        if (!date || !row.HomeTeam || !row.AwayTeam) continue;
        matches.push({
          code: div,
          date,
          status: row.FTHG === '' || row.FTHG == null ? 'SCHEDULED' : 'FINISHED',
          home: row.HomeTeam,
          away: row.AwayTeam,
          hg: num(row.FTHG),
          ag: num(row.FTAG),
          oddsH: num(row.B365H || row.BbAvH),
          oddsD: num(row.B365D || row.BbAvD),
          oddsA: num(row.B365A || row.BbAvA),
          referee: row.Referee || null,
          htH: num(row.HTHG),
          htA: num(row.HTAG),
          homeShots: num(row.HS),
          awayShots: num(row.AS),
          homeShotsOn: num(row.HST),
          awayShotsOn: num(row.AST),
          homeFouls: num(row.HF),
          awayFouls: num(row.AF),
          homeCorners: num(row.HC),
          awayCorners: num(row.AC),
          homeYellow: num(row.HY),
          awayYellow: num(row.AY),
          homeRed: num(row.HR),
          awayRed: num(row.AR),
          source: 'csv',
        });
      }
      if (matches.length >= target) {
        log.info({ csvMatches: matches.length }, 'csv target reached');
        return matches.slice(0, target);
      }
    }
  }
  log.info({ csvMatches: matches.length }, 'csv pulled');
  return matches;
}
