import gql from 'graphql-tag';
import { GraphQLError } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { dbAll, dbGet, ftsQuery } from '../shared/db.js';
import { groupBy, indexBy, makeLoader, marks } from '../shared/loaders.js';
import { createHttp } from '../shared/http.js';
import { env } from '../shared/env.js';

const http = createHttp('thesportsdb', { timeoutMs: 8000 });

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@external", "@requires"])
  type Stadium {
    id: ID!
    name: String!
    city: String
    country: String
    capacity: Int
    source: String!
  }
  type Player @key(fields: "id") {
    id: ID!
    name: String!
    position: String
    nationality: String
    birth: String
    source: String!
    team: Team
  }
  type Team @key(fields: "id") {
    id: ID!
    name: String!
    country: String
    founded: Int
    source: String!
    badge: String
    youtube: String
    stadium: Stadium
    players(limit: Int, offset: Int): [Player!]!
  }
  type TeamPage { items: [Team!]! total: Int! }
  type PlayerPage { items: [Player!]! total: Int! }
  type StadiumPage { items: [Stadium!]! total: Int! }
  extend type Match @key(fields: "id") {
    id: ID! @external
    homeTeamId: ID! @external
    awayTeamId: ID! @external
    homeTeam: Team @requires(fields: "homeTeamId")
    awayTeam: Team @requires(fields: "awayTeamId")
  }
  type Query {
    teams(limit: Int, offset: Int, country: String, search: String): TeamPage!
    team(id: ID!): Team
    players(limit: Int, offset: Int, search: String, teamId: ID): PlayerPage!
    stadiums(limit: Int, offset: Int, search: String, country: String): StadiumPage!
    liveProbe(teamName: String!): String
  }
`;

const mapStadium = (row) => row && ({
  id: String(row.id), name: row.name, city: row.city, country: row.country, capacity: row.capacity, source: row.source,
});
const mapTeam = (row) => row && ({
  id: String(row.id), name: row.name, country: row.country, founded: row.founded, source: row.source,
  badge: row.badge_url || null, youtube: row.youtube || null, stadiumId: row.stadium_id ? String(row.stadium_id) : null,
});
const mapPlayer = (row) => row && ({
  id: String(row.id), name: row.name, position: row.position, nationality: row.nationality, birth: row.birth, source: row.source, teamId: String(row.team_id),
});

function page(db, table, where, params, limit, offset, map) {
  const total = dbGet(db, `SELECT count(*) c FROM ${table} ${where}`, params).c;
  const items = dbAll(db, `SELECT * FROM ${table} ${where} ORDER BY name LIMIT ? OFFSET ?`, [...params, limit, offset]).map(map);
  return { items, total };
}

function ftsPage(db, fts, table, query, limit, offset, map, extra = '') {
  const match = ftsQuery(query);
  if (!match) return null;
  const total = dbGet(db, `SELECT count(*) c FROM ${fts} WHERE ${fts} MATCH ?`, [match]).c;
  const items = dbAll(db, `
    SELECT t.* FROM ${fts} f JOIN ${table} t ON t.id = f.rowid
    WHERE ${fts} MATCH ? ${extra} ORDER BY t.name LIMIT ? OFFSET ?`, [match, limit, offset]).map(map);
  return { items, total };
}

export function buildTeams(db) {
  const resolvers = {
    Query: {
      teams: (_, args) => {
        const limit = Math.min(args.limit || 20, 100);
        const offset = args.offset || 0;
        const found = args.search ? ftsPage(db, 'teams_fts', 'teams', args.search, limit, offset, mapTeam) : null;
        if (found) return found;
        const where = args.country ? 'WHERE country = ?' : '';
        return page(db, 'teams', where, args.country ? [args.country] : [], limit, offset, mapTeam);
      },
      team: (_, { id }, ctx) => ctx.loaders.team.load(id),
      players: (_, args) => {
        const limit = Math.min(args.limit || 20, 100);
        const offset = args.offset || 0;
        if (args.search) return ftsPage(db, 'players_fts', 'players', args.search, limit, offset, mapPlayer) || { items: [], total: 0 };
        const where = args.teamId ? 'WHERE team_id = ?' : '';
        return page(db, 'players', where, args.teamId ? [args.teamId] : [], limit, offset, mapPlayer);
      },
      stadiums: (_, args) => {
        const limit = Math.min(args.limit || 20, 100);
        const offset = args.offset || 0;
        if (args.search) return ftsPage(db, 'stadiums_fts', 'stadiums', args.search, limit, offset, mapStadium) || { items: [], total: 0 };
        const where = args.country ? 'WHERE country = ?' : '';
        return page(db, 'stadiums', where, args.country ? [args.country] : [], limit, offset, mapStadium);
      },
      liveProbe: async (_, { teamName }) => {
        try {
          const json = await http.json(
            `https://www.thesportsdb.com/api/v1/json/${env.sportsDbKey}/searchteams.php?t=${encodeURIComponent(teamName)}`,
            {},
            { retries: 2, pause: 300 },
          );
          return json?.teams?.[0]?.strDescriptionEN?.slice(0, 400) || null;
        } catch (error) {
          throw new GraphQLError('TheSportsDB unavailable', { extensions: { code: 'SUBGRAPH_DEGRADED', reason: error.message } });
        }
      },
    },
    Team: {
      __resolveReference: (ref, ctx) => ctx.loaders.team.load(ref.id),
      stadium: (team, _, ctx) => (team.stadiumId ? ctx.loaders.stadium.load(team.stadiumId) : null),
      players: async (team, args, ctx) => {
        const list = await ctx.loaders.players.load(team.id);
        const offset = args.offset || 0;
        return list.slice(offset, offset + (args.limit || 30));
      },
    },
    Player: {
      __resolveReference: (ref, ctx) => ctx.loaders.player.load(ref.id),
      team: (player, _, ctx) => ctx.loaders.team.load(player.teamId),
    },
    Match: {
      homeTeam: (match, _, ctx) => ctx.loaders.team.load(match.homeTeamId),
      awayTeam: (match, _, ctx) => ctx.loaders.team.load(match.awayTeamId),
    },
  };
  return buildSubgraphSchema({ typeDefs, resolvers });
}

export function contextFor(db, log) {
  return () => ({
    loaders: {
      team: makeLoader('team', log, async (ids) => indexBy(dbAll(db, `SELECT * FROM teams WHERE id IN (${marks(ids)})`, ids), ids).map(mapTeam)),
      player: makeLoader('player', log, async (ids) => indexBy(dbAll(db, `SELECT * FROM players WHERE id IN (${marks(ids)})`, ids), ids).map(mapPlayer)),
      stadium: makeLoader('stadium', log, async (ids) => indexBy(dbAll(db, `SELECT * FROM stadiums WHERE id IN (${marks(ids)})`, ids), ids).map(mapStadium)),
      players: makeLoader('players', log, async (ids) => groupBy(dbAll(db, `SELECT * FROM players WHERE team_id IN (${marks(ids)}) ORDER BY name`, ids), ids, 'team_id', mapPlayer)),
    },
  });
}
