import gql from 'graphql-tag';
import { GraphQLError } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { dbAll, dbGet } from '../shared/db.js';
import { groupBy, makeLoader, marks } from '../shared/loaders.js';

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@external"])
  type Favorite {
    id: ID!
    userId: ID!
    note: String
    createdAt: String!
    match: Match
  }
  type Comment {
    id: ID!
    userId: ID!
    body: String!
    createdAt: String!
    match: Match
  }
  type Note {
    id: ID!
    userId: ID!
    body: String!
    updatedAt: String!
    match: Match
  }
  extend type Match @key(fields: "id") {
    id: ID! @external
    comments: [Comment!]!
    notes: [Note!]!
    favorite: Favorite
  }
  input UserOpInput {
    op: String!
    id: ID
    matchId: ID
    body: String
    note: String
  }
  type BatchItem { kind: String! id: ID }
  type BatchResult { ok: Boolean! results: [BatchItem!]! }
  type Query {
    favorites: [Favorite!]!
    comments(matchId: ID!): [Comment!]!
    notes(matchId: ID): [Note!]!
  }
  type Mutation {
    createFavorite(matchId: ID!, note: String): Favorite!
    updateFavorite(id: ID!, note: String): Favorite!
    deleteFavorite(id: ID!): Boolean!
    createComment(matchId: ID!, body: String!): Comment!
    updateComment(id: ID!, body: String!): Comment!
    deleteComment(id: ID!): Boolean!
    createNote(matchId: ID!, body: String!): Note!
    updateNote(id: ID!, body: String!): Note!
    deleteNote(id: ID!): Boolean!
    batchUserOps(ops: [UserOpInput!]!): BatchResult!
  }
`;

const ref = (id) => ({ __typename: 'Match', id: String(id) });
const mapFav = (row) => row && ({ id: String(row.id), userId: row.user_id, note: row.note, createdAt: row.created_at, matchId: String(row.match_id) });
const mapComment = (row) => row && ({ id: String(row.id), userId: row.user_id, body: row.body, createdAt: row.created_at, matchId: String(row.match_id) });
const mapNote = (row) => row && ({ id: String(row.id), userId: row.user_id, body: row.body, updatedAt: row.updated_at, matchId: String(row.match_id) });
const now = () => new Date().toISOString();

function ops(db) {
  return {
    CREATE_FAVORITE: (op, userId) => mapFav(dbGet(db, `
      INSERT INTO favorites (user_id, match_id, note, created_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id, match_id) DO UPDATE SET note=excluded.note RETURNING *`, [userId, op.matchId, op.note || null, now()])),
    UPDATE_FAVORITE: (op, userId) => mapFav(dbGet(db, 'UPDATE favorites SET note=? WHERE id=? AND user_id=? RETURNING *', [op.note || null, op.id, userId])),
    DELETE_FAVORITE: (op, userId) => dbGet(db, 'DELETE FROM favorites WHERE id=? AND user_id=? RETURNING id', [op.id, userId]),
    CREATE_COMMENT: (op, userId) => {
      if (!op.body) throw new GraphQLError('comment body is required');
      return mapComment(dbGet(db, 'INSERT INTO comments (user_id, match_id, body, created_at) VALUES (?,?,?,?) RETURNING *', [userId, op.matchId, op.body, now()]));
    },
    UPDATE_COMMENT: (op, userId) => mapComment(dbGet(db, 'UPDATE comments SET body=? WHERE id=? AND user_id=? RETURNING *', [op.body || '', op.id, userId])),
    DELETE_COMMENT: (op, userId) => dbGet(db, 'DELETE FROM comments WHERE id=? AND user_id=? RETURNING id', [op.id, userId]),
    CREATE_NOTE: (op, userId) => mapNote(dbGet(db, `
      INSERT INTO notes (user_id, match_id, body, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id, match_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at RETURNING *`, [userId, op.matchId, op.body || '', now()])),
    UPDATE_NOTE: (op, userId) => mapNote(dbGet(db, 'UPDATE notes SET body=?, updated_at=? WHERE id=? AND user_id=? RETURNING *', [op.body || '', now(), op.id, userId])),
    DELETE_NOTE: (op, userId) => dbGet(db, 'DELETE FROM notes WHERE id=? AND user_id=? RETURNING id', [op.id, userId]),
  };
}

function runOp(db, op, userId) {
  const handler = ops(db)[op.op];
  if (!handler) throw new GraphQLError(`unknown op ${op.op}`);
  const row = handler(op, userId);
  if (!row) throw new GraphQLError(`${op.op} affected nothing`);
  const kind = op.op.split('_')[1].toLowerCase();
  return { kind, id: row.id ? String(row.id) : null };
}

export function buildUsers(db) {
  const resolvers = {
    Query: {
      favorites: (_, __, ctx) => dbAll(db, 'SELECT * FROM favorites WHERE user_id=? ORDER BY id DESC', [ctx.userId]).map(mapFav),
      comments: (_, { matchId }) => dbAll(db, 'SELECT * FROM comments WHERE match_id=? ORDER BY id DESC', [matchId]).map(mapComment),
      notes: (_, args, ctx) => dbAll(db, `SELECT * FROM notes WHERE user_id=? AND (? IS NULL OR match_id=?) ORDER BY id DESC`, [ctx.userId, args.matchId || null, args.matchId || null]).map(mapNote),
    },
    Mutation: {
      createFavorite: (_, args, ctx) => mapFav(dbGet(db, `
        INSERT INTO favorites (user_id, match_id, note, created_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id, match_id) DO UPDATE SET note=excluded.note RETURNING *`, [ctx.userId, args.matchId, args.note || null, now()])),
      updateFavorite: (_, args, ctx) => mapFav(dbGet(db, 'UPDATE favorites SET note=? WHERE id=? AND user_id=? RETURNING *', [args.note || null, args.id, ctx.userId])),
      deleteFavorite: (_, { id }, ctx) => Boolean(dbGet(db, 'DELETE FROM favorites WHERE id=? AND user_id=? RETURNING id', [id, ctx.userId])),
      createComment: (_, args, ctx) => mapComment(dbGet(db, 'INSERT INTO comments (user_id, match_id, body, created_at) VALUES (?,?,?,?) RETURNING *', [ctx.userId, args.matchId, args.body, now()])),
      updateComment: (_, args, ctx) => mapComment(dbGet(db, 'UPDATE comments SET body=? WHERE id=? AND user_id=? RETURNING *', [args.body, args.id, ctx.userId])),
      deleteComment: (_, { id }, ctx) => Boolean(dbGet(db, 'DELETE FROM comments WHERE id=? AND user_id=? RETURNING id', [id, ctx.userId])),
      createNote: (_, args, ctx) => mapNote(dbGet(db, `
        INSERT INTO notes (user_id, match_id, body, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id, match_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at RETURNING *`, [ctx.userId, args.matchId, args.body, now()])),
      updateNote: (_, args, ctx) => mapNote(dbGet(db, 'UPDATE notes SET body=?, updated_at=? WHERE id=? AND user_id=? RETURNING *', [args.body, now(), args.id, ctx.userId])),
      deleteNote: (_, { id }, ctx) => Boolean(dbGet(db, 'DELETE FROM notes WHERE id=? AND user_id=? RETURNING id', [id, ctx.userId])),
      batchUserOps: (_, { ops: items }, ctx) => {
        const results = [];
        const tx = db.transaction(() => { for (const item of items) results.push(runOp(db, item, ctx.userId)); });
        tx();
        return { ok: true, results };
      },
    },
    Favorite: { match: (row) => ref(row.matchId) },
    Comment: { match: (row) => ref(row.matchId) },
    Note: { match: (row) => ref(row.matchId) },
    Match: {
      __resolveReference: (ref) => ({ id: String(ref.id) }),
      comments: (match, _, ctx) => ctx.loaders.comments.load(match.id),
      notes: (match, _, ctx) => ctx.loaders.notes.load(match.id),
      favorite: (match, _, ctx) => ctx.loaders.favorite.load(match.id),
    },
  };
  return buildSubgraphSchema({ typeDefs, resolvers });
}

export function contextFor(db, log) {
  return ({ req }) => {
    const userId = req.headers['x-user-id'] || 'demo';
    return {
      userId,
      loaders: {
        comments: makeLoader('comments', log, async (ids) => groupBy(dbAll(db, `SELECT * FROM comments WHERE match_id IN (${marks(ids)}) ORDER BY id DESC`, ids), ids, 'match_id', mapComment)),
        notes: makeLoader('notes', log, async (ids) => groupBy(dbAll(db, `SELECT * FROM notes WHERE user_id=? AND match_id IN (${marks(ids)})`, [userId, ...ids]), ids, 'match_id', mapNote)),
        favorite: makeLoader('favorite', log, async (ids) => {
          const rows = dbAll(db, `SELECT * FROM favorites WHERE user_id=? AND match_id IN (${marks(ids)})`, [userId, ...ids]).map(mapFav);
          const map = new Map(rows.map((row) => [row.matchId, row]));
          return ids.map((id) => map.get(String(id)) || null);
        }),
      },
    };
  };
}
