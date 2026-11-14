import { createClient } from 'graphql-ws';
import { LIVE_WS, gql } from './api.js';
import { builderState, buildMatchQuery } from './queryBuilder.js';
import * as pages from './pages.js';

const app = document.querySelector('#app');
const listState = { date: '', leagueId: '', leagues: [] };
const tableState = { leagueId: '', leagues: [] };
let liveStop = () => {};

const DAY = `query Day($date:String!,$leagueId:ID) {
  dayMatches(date:$date, leagueId:$leagueId) {
    id utcDate status homeGoals awayGoals homeName awayName
    homeTeam { badge } awayTeam { badge }
    season { league { id name country } }
  }
}`;
const TABLE = `query Table($leagueId:ID!) {
  leagueTable(leagueId:$leagueId) {
    seasonLabel waiting
    rows { position played won drawn lost goalsFor goalsAgainst goalDiff points team { name badge stadium { name } } }
  }
}`;
const MATCH = `query Match($id:ID!) { match(id:$id) {
  id utcDate status homeGoals awayGoals homeName awayName source referee
  protocol { venue halfHome halfAway homeShots awayShots homeShotsOn awayShotsOn homeFouls awayFouls homeCorners awayCorners homeYellow awayYellow homeRed awayRed }
  season { label league { name country } }
  events { minute type playerName detail source }
  homeTeam { name country badge youtube stadium { name city capacity } players { name position } }
  awayTeam { name country badge youtube stadium { name } players { name position } }
  comments { id body } notes { id body } favorite { id note }
} }`;

window.addEventListener('hashchange', draw);
document.body.addEventListener('click', onClick);
document.body.addEventListener('submit', onSubmit);
document.body.addEventListener('change', onChange);
draw();

function path() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

async function draw() {
  liveStop();
  liveStop = () => {};
  const [name, id] = path();
  if (name === 'match' && id) return renderMatch(id);
  if (name === 'teams') return renderTeams('');
  if (name === 'favorites') return renderFavorites();
  if (name === 'builder') return renderBuilder();
  if (name === 'table') return renderTable();
  return renderMatches();
}

async function renderMatches() {
  if (!listState.leagues.length || !listState.date) {
    const today = new Date().toISOString().slice(0, 10);
    const boot = await gql(`query($today:String){ leagues(limit:20){ id name } matches(first:1, filter:{dateTo:$today}, sort:[{field:"DATE", direction:"DESC"}]) { edges { node { utcDate } } } }`, { today });
    if (!boot.data?.leagues?.length) {
      app.innerHTML = pages.errors(boot) || `<p class="error">Не удалось загрузить лиги</p>`;
      return;
    }
    listState.leagues = boot.data.leagues;
    listState.date = listState.date || boot.data?.matches?.edges?.[0]?.node?.utcDate || today;
  }
  const json = await gql(DAY, { date: listState.date, leagueId: listState.leagueId || null });
  app.innerHTML = pages.dayBar(listState.date, listState.leagueId, listState.leagues) + pages.dayBoard(json);
}

async function renderMatch(id) {
  app.innerHTML = pages.matchCard(await gql(MATCH, { id }));
}

async function renderTeams(search) {
  app.innerHTML = pages.teamList(await gql(`query($search:String){ teams(search:$search, limit:20){ total items { name country badge stadium { name } } } }`, { search: search || null }));
  if (search) document.querySelector('#team-search').elements.search.value = search;
}

async function renderFavorites() {
  app.innerHTML = pages.favorites(await gql(`query { favorites { id note match { id homeName awayName } } }`));
}

function renderBuilder() {
  const query = buildMatchQuery(['utcDate', 'status', 'homeGoals', 'awayGoals', 'source', 'homeName', 'awayName'], {});
  app.innerHTML = pages.builder(escapeHtml(query), '');
}

async function renderTable(resubscribe = true) {
  if (!tableState.leagues.length) {
    const boot = await gql(`query { leagues(limit:20) { id name } }`);
    tableState.leagues = boot.data?.leagues || [];
    tableState.leagueId = tableState.leagueId || tableState.leagues[0]?.id || '';
  }
  if (!tableState.leagueId) {
    app.innerHTML = '<p>Лиги не найдены</p>';
    return;
  }
  const json = await gql(TABLE, { leagueId: tableState.leagueId });
  app.innerHTML = pages.errors(json) + pages.standings(tableState.leagues, tableState.leagueId, json.data?.leagueTable);
  if (resubscribe) watchFinished();
}

function watchFinished() {
  liveStop();
  const seen = new Set();
  const client = createClient({ url: LIVE_WS });
  const dispose = client.subscribe({
    query: 'subscription { matchScoreUpdated { matchId status } }',
  }, {
    next: (msg) => {
      const score = msg.data?.matchScoreUpdated;
      if (!score || score.status !== 'FINISHED' || seen.has(score.matchId)) return;
      seen.add(score.matchId);
      if (path()[0] === 'table') renderTable(false);
    },
    error: () => {},
    complete: () => {},
  });
  liveStop = () => { dispose(); client.dispose(); };
}

async function onSubmit(event) {
  const form = event.target;
  if (form.id === 'day') {
    event.preventDefault();
    listState.date = new FormData(form).get('date');
    listState.leagueId = new FormData(form).get('league');
    await renderMatches();
  } else if (form.id === 'table-league') {
    event.preventDefault();
    tableState.leagueId = new FormData(form).get('league');
    await renderTable();
  } else if (form.id === 'team-search') {
    event.preventDefault();
    await renderTeams(new FormData(form).get('search'));
  } else if (form.id === 'builder') {
    event.preventDefault();
    const { query, variables } = builderState(form);
    const json = await gql(query, variables, { apq: true });
    app.innerHTML = pages.builder(escapeHtml(query), escapeHtml(JSON.stringify(json, null, 2)));
  } else if (form.id === 'fav' || form.id === 'note' || form.id === 'comment') {
    event.preventDefault();
    const id = path()[1];
    const body = new FormData(form).get(form.id === 'fav' ? 'note' : 'body');
    const mutation = form.id === 'fav'
      ? `mutation($id:ID!,$note:String){ createFavorite(matchId:$id, note:$note){ id } }`
      : form.id === 'note'
        ? `mutation($id:ID!,$body:String!){ createNote(matchId:$id, body:$body){ id } }`
        : `mutation($id:ID!,$body:String!){ createComment(matchId:$id, body:$body){ id } }`;
    await gql(mutation, form.id === 'fav' ? { id, note: body } : { id, body });
    await renderMatch(id);
  }
}

async function onClick(event) {
  const prev = event.target.closest('#prev-day');
  const next = event.target.closest('#next-day');
  const fav = event.target.closest('[data-del-fav]');
  const comment = event.target.closest('[data-del-comment]');
  if (prev || next) {
    listState.date = shiftDate(listState.date, prev ? -1 : 1);
    return renderMatches();
  }
  if (fav) {
    await gql(`mutation($id:ID!){ deleteFavorite(id:$id) }`, { id: fav.dataset.delFav });
    return draw();
  }
  if (comment) {
    await gql(`mutation($id:ID!){ deleteComment(id:$id) }`, { id: comment.dataset.delComment });
    return renderMatch(path()[1]);
  }
}

function onChange(event) {
  const form = event.target.form;
  if (event.target.closest('#builder')) {
    document.querySelector('#query-preview').textContent = builderState(form).query;
  } else if (form?.id === 'day') {
    listState.date = form.elements.date.value;
    listState.leagueId = form.elements.league.value;
    renderMatches();
  } else if (form?.id === 'table-league') {
    tableState.leagueId = form.elements.league.value;
    renderTable();
  }
}

function shiftDate(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}
