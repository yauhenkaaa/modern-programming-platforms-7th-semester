import gql from 'graphql-tag';
import { GraphQLError } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { dbAll, dbGet, decodeCursor, encodeCursor } from '../shared/db.js';
import { groupBy, indexBy, makeLoader, marks } from '../shared/loaders.js';
import { liveMatchIds, onScore, pendingLiveIds } from './live.js';

const SORTS = {
  DATE: 'm.utc_date',
  HOME_GOALS: 'm.home_goals',
  AWAY_GOALS: 'm.away_goals',
  STATUS: 'm.status',
};

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@external"])
  extend type Team @key(fields: "id") {
    id: ID! @external
  }
  type League @key(fields: "id") {
    id: ID!
    name: String!
    code: String!
    country: String
    seasons: [Season!]!
  }
  type Season @key(fields: "id") {
    id: ID!
    year: Int!
    label: String
    league: League!
    matches(first: Int, after: String, filter: MatchFilter, sort: [SortInput!]): MatchConnection!
  }
  type Match @key(fields: "id") {
    id: ID!
    utcDate: String!
    status: String!
    homeGoals: Int
    awayGoals: Int
    homeTeamId: ID!
    awayTeamId: ID!
    homeName: String!
    awayName: String!
    oddsHome: Float
    oddsDraw: Float
    oddsAway: Float
    source: String!
    referee: String
    protocol: MatchProtocol!
    season: Season!
    events: [MatchEvent!]!
  }
  type MatchProtocol {
    venue: String
    halfHome: Int
    halfAway: Int
    homeShots: Int
    awayShots: Int
    homeShotsOn: Int
    awayShotsOn: Int
    homeFouls: Int
    awayFouls: Int
    homeCorners: Int
    awayCorners: Int
    homeYellow: Int
    awayYellow: Int
    homeRed: Int
    awayRed: Int
  }
  type MatchEvent {
    id: ID!
    minute: Int
    type: String!
    playerName: String
    detail: String
    teamId: ID
    source: String!
  }
  type MatchEdge { cursor: String! node: Match! }
  type PageInfo { hasNextPage: Boolean! endCursor: String }
  type MatchConnection { edges: [MatchEdge!]! pageInfo: PageInfo! totalCount: Int! }
  input MatchFilter {
    leagueId: ID
    seasonId: ID
    teamId: ID
    dateFrom: String
    dateTo: String
    country: String
    status: String
    minGoals: Int
    maxGoals: Int
    search: String
  }
  input SortInput { field: String! direction: String }
  type Query {
    leagues(limit: Int, offset: Int, country: String): [League!]!
    league(id: ID!): League
    seasons(leagueId: ID, limit: Int, offset: Int): [Season!]!
    match(id: ID!): Match
    matches(first: Int, after: String, filter: MatchFilter, sort: [SortInput!]): MatchConnection!
    dayMatches(date: String!, leagueId: ID): [Match!]!
    leagueTable(leagueId: ID!): LeagueTable!
    liveMatches: [Match!]!
  }
  type Standing {
    position: Int!
    played: Int!
    won: Int!
    drawn: Int!
    lost: Int!
    goalsFor: Int!
    goalsAgainst: Int!
    goalDiff: Int!
    points: Int!
    team: Team!
  }
  type LeagueTable {
    seasonLabel: String
    waiting: Int!
    rows: [Standing!]!
  }
`;

const mapLeague = (row) => row && ({ id: String(row.id), name: row.name, code: row.code, country: row.country });
const mapSeason = (row) => row && ({ id: String(row.id), year: row.year, label: row.label, leagueId: String(row.league_id) });
const mapMatch = (row) => row && ({
  id: String(row.id), utcDate: row.utc_date, status: row.status,
  homeGoals: row.home_goals, awayGoals: row.away_goals,
  homeTeamId: String(row.home_team_id), awayTeamId: String(row.away_team_id),
  homeName: row.home_name, awayName: row.away_name,
  oddsHome: row.odds_home, oddsDraw: row.odds_draw, oddsAway: row.odds_away,
  source: row.source, referee: row.referee || null, seasonId: String(row.season_id),
  protocol: {
    venue: row.venue || null,
    halfHome: row.ht_home, halfAway: row.ht_away,
    homeShots: row.home_shots, awayShots: row.away_shots,
    homeShotsOn: row.home_shots_on, awayShotsOn: row.away_shots_on,
    homeFouls: row.home_fouls, awayFouls: row.away_fouls,
    homeCorners: row.home_corners, awayCorners: row.away_corners,
    homeYellow: row.home_yellow, awayYellow: row.away_yellow,
    homeRed: row.home_red, awayRed: row.away_red,
  },
});
const mapEvent = (row) => ({
  id: String(row.id), minute: row.minute, type: row.type, playerName: row.player_name || null,
  detail: row.detail, teamId: row.team_id ? String(row.team_id) : null, source: row.source,
});

function connection(db, args) {
  const filter = { ...(args.filter || {}) };
  if (args.seasonId) filter.seasonId = args.seasonId;
  const where = [];
  const params = [];
  const add = (sql, ...values) => { where.push(sql); params.push(...values); };
  if (filter.leagueId) add('s.league_id = ?', filter.leagueId);
  if (filter.seasonId) add('m.season_id = ?', filter.seasonId);
  if (filter.teamId) add('(m.home_team_id = ? OR m.away_team_id = ?)', filter.teamId, filter.teamId);
  if (filter.dateFrom) add('m.utc_date >= ?', filter.dateFrom);
  if (filter.dateTo) add('m.utc_date <= ?', filter.dateTo);
  if (filter.country) add('l.country = ?', filter.country);
  if (filter.status) add('m.status = ?', filter.status);
  if (filter.minGoals != null) add('(coalesce(m.home_goals,0)+coalesce(m.away_goals,0)) >= ?', filter.minGoals);
  if (filter.maxGoals != null) add('(coalesce(m.home_goals,0)+coalesce(m.away_goals,0)) <= ?', filter.maxGoals);
  if (filter.search) {
    const q = `%${String(filter.search).replace(/[%_]/g, '')}%`;
    add('(m.home_name LIKE ? OR m.away_name LIKE ?)', q, q);
  }
  if (args.ids?.length) add(`m.id IN (${marks(args.ids)})`, ...args.ids);
  const sort = (args.sort?.length ? args.sort : [{ field: 'DATE', direction: 'DESC' }]).flatMap((item) => {
    const column = SORTS[String(item.field || '').toUpperCase()];
    if (!column) return [];
    const direction = String(item.direction || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    return [`${column} ${direction}`];
  });
  sort.push('m.id ASC');
  const offset = decodeCursor(args.after);
  const limit = Math.min(Math.max(Number(args.first) || 20, 1), 50);
  const from = 'FROM matches m JOIN seasons s ON s.id = m.season_id JOIN leagues l ON l.id = s.league_id';
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = dbGet(db, `SELECT count(*) c ${from} ${clause}`, params).c;
  const rows = dbAll(db, `SELECT m.* ${from} ${clause} ORDER BY ${sort.join(', ')} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const edges = rows.map((row, index) => ({ cursor: encodeCursor(offset + index + 1), node: mapMatch(row) }));
  return { edges, totalCount: total, pageInfo: { hasNextPage: offset + rows.length < total, endCursor: edges.at(-1)?.cursor || null } };
}

function leagueTable(db, leagueId) {
  const season = dbGet(db, 'SELECT id, label FROM seasons WHERE league_id = ? ORDER BY year DESC LIMIT 1', [leagueId]);
  if (!season) return { seasonLabel: null, waiting: 0, rows: [] };
  const pending = pendingLiveIds();
  const skip = pending.length ? ` AND m.id NOT IN (${pending.map(() => '?').join(',')})` : '';
  const rows = dbAll(db, `
    SELECT m.home_team_id, m.away_team_id, m.home_name, m.away_name, m.home_goals, m.away_goals
    FROM matches m
    WHERE m.season_id = ? AND m.status = 'FINISHED' AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL${skip}`, [season.id, ...pending]);
  const waiting = pending.length
    ? dbGet(db, `SELECT count(*) c FROM matches WHERE season_id = ? AND id IN (${pending.map(() => '?').join(',')})`, [season.id, ...pending]).c
    : 0;
  const table = new Map();
  const side = (id, name) => {
    const key = String(id);
    if (!table.has(key)) table.set(key, { teamId: key, name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
    return table.get(key);
  };
  for (const row of rows) {
    const home = side(row.home_team_id, row.home_name);
    const away = side(row.away_team_id, row.away_name);
    home.played += 1;
    away.played += 1;
    home.goalsFor += row.home_goals;
    home.goalsAgainst += row.away_goals;
    away.goalsFor += row.away_goals;
    away.goalsAgainst += row.home_goals;
    if (row.home_goals > row.away_goals) { home.won += 1; away.lost += 1; }
    else if (row.home_goals < row.away_goals) { away.won += 1; home.lost += 1; }
    else { home.drawn += 1; away.drawn += 1; }
  }
  const ranked = [...table.values()]
    .map((team) => ({ ...team, goalDiff: team.goalsFor - team.goalsAgainst, points: team.won * 3 + team.drawn }))
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name));
  return {
    seasonLabel: season.label,
    waiting,
    rows: ranked.map((team, index) => ({ ...team, position: index + 1 })),
  };
}

export function buildMatches(db) {
  const resolvers = {
    Query: {
      leagues: (_, args) => dbAll(db, `SELECT * FROM leagues WHERE (? IS NULL OR country = ?) ORDER BY name LIMIT ? OFFSET ?`, [args.country || null, args.country || null, Math.min(args.limit || 20, 100), args.offset || 0]).map(mapLeague),
      league: (_, { id }, ctx) => ctx.loaders.league.load(id),
      seasons: (_, args) => dbAll(db, `SELECT * FROM seasons WHERE (? IS NULL OR league_id = ?) ORDER BY year DESC LIMIT ? OFFSET ?`, [args.leagueId || null, args.leagueId || null, Math.min(args.limit || 20, 100), args.offset || 0]).map(mapSeason),
      match: (_, { id }, ctx) => ctx.loaders.match.load(id),
      matches: (_, args) => connection(db, args),
      dayMatches: (_, { date, leagueId }) => dbAll(db, `
        SELECT m.* FROM matches m JOIN seasons s ON s.id = m.season_id
        WHERE m.utc_date = ? AND (? IS NULL OR s.league_id = ?)
        ORDER BY s.league_id, m.id`, [date, leagueId || null, leagueId || null]).map(mapMatch),
      leagueTable: (_, { leagueId }) => leagueTable(db, leagueId),
      liveMatches: async (_, __, ctx) => {
        const ids = liveMatchIds().filter((id) => id !== 'demo');
        if (!ids.length) return [];
        const rows = await ctx.loaders.match.loadMany(ids);
        return rows.filter(Boolean);
      },
    },
    League: {
      __resolveReference: (ref, ctx) => ctx.loaders.league.load(ref.id),
      seasons: (league) => dbAll(db, 'SELECT * FROM seasons WHERE league_id = ? ORDER BY year DESC', [league.id]).map(mapSeason),
    },
    Season: {
      __resolveReference: (ref, ctx) => ctx.loaders.season.load(ref.id),
      league: (season, _, ctx) => ctx.loaders.league.load(season.leagueId),
      matches: (season, args) => connection(db, { ...args, seasonId: season.id }),
    },
    Match: {
      __resolveReference: (ref, ctx) => ctx.loaders.match.load(ref.id),
      season: (match, _, ctx) => ctx.loaders.season.load(match.seasonId),
      events: (match, _, ctx) => ctx.loaders.events.load(match.id),
    },
    Standing: {
      team: (row) => ({ id: row.teamId }),
    },
  };
  return buildSubgraphSchema({ typeDefs, resolvers });
}

export function contextFor(db, log) {
  return () => ({
    loaders: {
      match: makeLoader('match', log, async (ids) => indexBy(dbAll(db, `SELECT * FROM matches WHERE id IN (${marks(ids)})`, ids), ids).map(mapMatch)),
      league: makeLoader('league', log, async (ids) => indexBy(dbAll(db, `SELECT * FROM leagues WHERE id IN (${marks(ids)})`, ids), ids).map(mapLeague)),
      season: makeLoader('season', log, async (ids) => indexBy(dbAll(db, `SELECT * FROM seasons WHERE id IN (${marks(ids)})`, ids), ids).map(mapSeason)),
      events: makeLoader('events', log, async (ids) => groupBy(dbAll(db, `SELECT * FROM events WHERE match_id IN (${marks(ids)}) ORDER BY minute`, ids), ids, 'match_id', mapEvent)),
    },
  });
}

export function liveSchema() {
  return makeExecutableSchema({
    typeDefs: `type Query { _ok: Boolean } type LiveScore { matchId: ID! minute: Int! homeGoals: Int! awayGoals: Int! status: String! homeName: String awayName: String } type Subscription { matchScoreUpdated(matchId: ID): LiveScore! }`,
    resolvers: {
      Query: { _ok: () => true },
      Subscription: {
        matchScoreUpdated: {
          subscribe: async function* (_, args) {
            const queue = [];
            let wake;
            const stop = onScore((score) => {
              if (args.matchId && String(score.matchId) !== String(args.matchId)) return;
              queue.push(score);
              wake?.();
              wake = null;
            });
            try {
              while (true) {
                if (!queue.length) await new Promise((resolve) => { wake = resolve; });
                while (queue.length) yield { matchScoreUpdated: queue.shift() };
              }
            } finally {
              stop();
            }
          },
        },
      },
    },
  });
}

export function assertSort(sort) {
  if (sort?.some((item) => !SORTS[String(item.field || '').toUpperCase()])) {
    throw new GraphQLError('unknown sort field');
  }
}
