const ALIAS = {
  'man city': 'manchester city',
  'man united': 'manchester united',
  'manchester utd': 'manchester united',
  spurs: 'tottenham hotspur',
  tottenham: 'tottenham hotspur',
  "nott'm forest": 'nottingham forest',
  'nott m forest': 'nottingham forest',
  'nottm forest': 'nottingham forest',
  wolves: 'wolverhampton wanderers',
  leicester: 'leicester city',
  leeds: 'leeds united',
  brighton: 'brighton and hove albion',
  newcastle: 'newcastle united',
  'west ham': 'west ham united',
  'sheff utd': 'sheffield united',
  'sheff wed': 'sheffield wednesday',
  qpr: 'queens park rangers',
  ipswich: 'ipswich town',
  'atletico de madrid': 'ath madrid',
  'club atletico de madrid': 'ath madrid',
  'athletic club': 'ath bilbao',
  'athletic bilbao': 'ath bilbao',
  'atletico madrid': 'ath madrid',
  'celta vigo': 'celta',
  'celta de vigo': 'celta',
  espanol: 'espanyol',
  'espanyol de barcelona': 'espanyol',
  'deportivo la coruna': 'deportivo',
  'deportivo de a coruna': 'deportivo',
  hamburg: 'hamburger',
  'inter milan': 'inter',
  'm gladbach': 'gladbach',
  'ein frankfurt': 'frankfurt',
  'eintracht frankfurt': 'frankfurt',
  birmingham: 'birmingham city',
  blackburn: 'blackburn rovers',
  cardiff: 'cardiff city',
  coventry: 'coventry city',
  derby: 'derby county',
  charlton: 'charlton athletic',
  hull: 'hull city',
  'sheffield weds': 'sheffield wednesday',
  'real betis balompie': 'betis',
  'real sociedad de futbol': 'sociedad',
  'rayo vallecano de madrid': 'vallecano',
  'real sociedad': 'sociedad',
  'real betis': 'betis',
  'rayo vallecano': 'vallecano',
  'deportivo alaves': 'alaves',
  'internazionale': 'inter',
  'internazionale milano': 'inter',
  'bayern munchen': 'bayern munich',
  'borussia dortmund': 'dortmund',
  'bayer 04 leverkusen': 'leverkusen',
  'bayer leverkusen': 'leverkusen',
  'borussia monchengladbach': 'gladbach',
  'paris saint germain': 'paris sg',
  'olympique de marseille': 'marseille',
  'olympique lyonnais': 'lyon',
  'wolverhampton wanderers fc': 'wolverhampton wanderers',
};

export const LEAGUES = {
  E0: ['Premier League', 'England'],
  E1: ['Championship', 'England'],
  SP1: ['La Liga', 'Spain'],
  D1: ['Bundesliga', 'Germany'],
  I1: ['Serie A', 'Italy'],
  F1: ['Ligue 1', 'France'],
  SYN: ['Synthetic Cup', 'World'],
};

const EDGE = new Set(['fc', 'cf', 'afc', 'ac', 'acf', 'as', 'ss', 'ssc', 'us', 'ca', 'rc', 'rcd', 'sc', 'sv', 'tsg', 'vfb', 'cfc', 'ud', 'bc', 'fsv', 'cd', 'sad', 'club', 'calcio']);

function stripEdges(base) {
  const parts = base.split(' ').filter(Boolean);
  while (parts.length > 1 && EDGE.has(parts[0])) parts.shift();
  while (parts.length > 1 && EDGE.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

export function normName(value) {
  const cleaned = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(18|19|20)\d{2}\b/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (ALIAS[cleaned]) return ALIAS[cleaned];
  const stripped = stripEdges(cleaned);
  return ALIAS[stripped] || stripped;
}

export function parseCsvDate(value) {
  const [d, m, y] = String(value || '').split(/[/-]/);
  if (!d || !m || !y) return null;
  const year = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function seasonYear(iso) {
  const [year, month] = String(iso).split('-').map(Number);
  if (!year || !month) return null;
  return month >= 7 ? year : year - 1;
}

export function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
