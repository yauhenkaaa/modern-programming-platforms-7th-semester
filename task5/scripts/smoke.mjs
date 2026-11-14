import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const gateway = process.env.GATEWAY_URL || 'http://127.0.0.1:4000/graphql';
const headers = { 'content-type': 'application/json', 'x-user-id': 'smoke' };

async function gql(query, variables) {
  const res = await fetch(gateway, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors?.length && !json.data) throw new Error(json.errors.map((error) => error.message).join('; '));
  return json.data;
}

const health = await fetch('http://127.0.0.1:4000/health');
if (!health.ok) throw new Error('gateway health failed');

const nested = await gql(`query { leagues(limit:1) { name seasons { label matches(first:1) { edges { node { id homeName homeTeam { name players(limit:1) { name } } } } } } } }`);
const matchId = nested.leagues[0].seasons.find((season) => season.matches.edges.length)?.matches.edges[0].node.id;
if (!matchId) throw new Error('nested query returned no match');

const filtered = await gql(`query { matches(first:3, filter:{ status:"FINISHED", minGoals:1 }, sort:[{field:"DATE", direction:"DESC"},{field:"HOME_GOALS", direction:"ASC"}]) { totalCount edges { node { id } } } }`);
if (!filtered.matches.totalCount) throw new Error('filter returned nothing');

const found = await gql(`query { teams(search:"united", limit:5) { total items { name } } players(search:"a", limit:3) { total } stadiums(limit:1) { total items { name } } }`);
if (!found.teams.total && !found.stadiums.total) throw new Error('search returned nothing');

const favorite = await gql(`mutation($id:ID!){ createFavorite(matchId:$id, note:"smoke"){ id } }`, { id: matchId });
const batch = await gql(`mutation($ops:[UserOpInput!]!){ batchUserOps(ops:$ops){ ok results { kind id } } }`, {
  ops: [
    { op: 'CREATE_COMMENT', matchId, body: 'batch comment' },
    { op: 'CREATE_NOTE', matchId, body: 'batch note' },
  ],
});
if (!batch.batchUserOps.ok) throw new Error('batch failed');
await gql(`mutation($id:ID!){ deleteFavorite(id:$id) }`, { id: favorite.createFavorite.id });

const metrics = await fetch('http://127.0.0.1:4000/metrics');
if (!metrics.ok || !(await metrics.text()).includes('graphql_operations_total')) throw new Error('metrics missing');

const score = await new Promise((resolve, reject) => {
  const client = createClient({ url: process.env.LIVE_WS || 'ws://127.0.0.1:4001/graphql', webSocketImpl: WebSocket });
  const timer = setTimeout(() => { client.dispose(); reject(new Error('subscription timeout')); }, 8000);
  client.subscribe({ query: 'subscription { matchScoreUpdated { matchId minute homeGoals status } }' }, {
    next: (msg) => { clearTimeout(timer); client.dispose(); resolve(msg.data.matchScoreUpdated); },
    error: (err) => { clearTimeout(timer); reject(err); },
    complete: () => {},
  });
});
if (!score?.matchId) throw new Error('empty subscription payload');
console.log(JSON.stringify({ ok: true, matchId, total: filtered.matches.totalCount, teams: found.teams.total, score }, null, 2));
