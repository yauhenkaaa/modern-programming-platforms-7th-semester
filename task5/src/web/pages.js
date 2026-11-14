export function errors(json) {
  if (!json?.errors?.length) return '';
  return `<div class="error">${json.errors.map((error) => error.message).join('; ')}</div>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function crest(url, name) {
  if (url && /^https?:\/\//.test(url)) return `<img class="crest" src="${esc(url)}" alt="${esc(name || '')}" referrerpolicy="no-referrer" />`;
  return `<span class="crest letter">${esc((name || '?').slice(0, 1))}</span>`;
}

const EVENT_LABEL = { GOAL: 'Гол', OWN_GOAL: 'Автогол', YELLOW: 'Жёлтая', RED: 'Красная', SUB: 'Замена' };

function leagueOptions(leagues, selected) {
  return (leagues || []).map((league) => `<option value="${esc(league.id)}" ${String(league.id) === String(selected) ? 'selected' : ''}>${esc(league.name)}</option>`).join('');
}

export function dayBar(date, leagueId, leagues) {
  return `<form id="day" class="card daybar">
    <button type="button" id="prev-day" aria-label="Предыдущий день">←</button>
    <input type="date" name="date" value="${esc(date)}" />
    <button type="button" id="next-day" aria-label="Следующий день">→</button>
    <select name="league"><option value="">Все лиги</option>${leagueOptions(leagues, leagueId)}</select>
  </form>`;
}

function fixture(node) {
  return `<a class="fixture" href="#/match/${node.id}">
    <span class="side">${crest(node.homeTeam?.badge, node.homeName)}<span>${esc(node.homeName)}</span></span>
    <span class="result"><b>${node.homeGoals ?? '–'}:${node.awayGoals ?? '–'}</b><small>${esc(node.status)}</small></span>
    <span class="side away"><span>${esc(node.awayName)}</span>${crest(node.awayTeam?.badge, node.awayName)}</span>
  </a>`;
}

export function dayBoard(json) {
  const matches = json?.data?.dayMatches || [];
  if (!matches.length) return `${errors(json)}<p class="muted">В этот день матчей нет</p>`;
  const groups = new Map();
  for (const match of matches) {
    const league = match.season?.league;
    const key = league?.id || 'other';
    if (!groups.has(key)) groups.set(key, { name: league?.name || 'Лига', country: league?.country || '', matches: [] });
    groups.get(key).matches.push(match);
  }
  return `${errors(json)}${[...groups.values()].map((group) => `<h2 class="league-head">${esc(group.name)} <span class="muted">${esc(group.country)}</span></h2><div class="card">${group.matches.map(fixture).join('')}</div>`).join('')}`;
}

export function standings(leagues, leagueId, table) {
  const rows = table?.rows || [];
  const body = rows.map((row) => `<tr>
    <td>${row.position}</td>
    <td class="club">${crest(row.team?.badge, row.team?.name)}<span>${esc(row.team?.name)}${row.team?.stadium?.name ? `<small class="muted">${esc(row.team.stadium.name)}</small>` : ''}</span></td>
    <td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td>
    <td>${row.goalsFor}:${row.goalsAgainst}</td>
    <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
    <td><b>${row.points}</b></td>
  </tr>`).join('') || '<tr><td colspan="9">Нет сыгранных матчей</td></tr>';
  const waiting = table?.waiting ? `<p class="muted">В повторе ещё ${table.waiting}: таблица дополнится после финального свистка.</p>` : '';
  return `<form id="table-league" class="card"><select name="league">${leagueOptions(leagues, leagueId)}</select></form>
    <p class="muted">${esc(table?.seasonLabel || '')}</p>${waiting}
    <div class="card"><table class="standings"><thead><tr><th>#</th><th>Клуб</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>Мячи</th><th>Р</th><th>О</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function reviewUrl(match) {
  const query = `${match.homeName} ${match.awayName} ${match.utcDate} highlights`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function channelLink(team) {
  if (!team?.youtube) return '';
  return `<a class="yt" href="${esc(team.youtube)}" target="_blank" rel="noopener">Канал ${esc(team.name)}</a>`;
}

function pair(home, away) {
  if (home == null && away == null) return '';
  return `${home ?? '–'}:${away ?? '–'}`;
}

function protocolSheet(match) {
  const sheet = match.protocol || {};
  const rows = [
    ['Тайм', pair(sheet.halfHome, sheet.halfAway)],
    ['Удары', pair(sheet.homeShots, sheet.awayShots)],
    ['В створ', pair(sheet.homeShotsOn, sheet.awayShotsOn)],
    ['Угловые', pair(sheet.homeCorners, sheet.awayCorners)],
    ['Фолы', pair(sheet.homeFouls, sheet.awayFouls)],
    ['Жёлтые', pair(sheet.homeYellow, sheet.awayYellow)],
    ['Красные', pair(sheet.homeRed, sheet.awayRed)],
  ].filter(([, value]) => value);
  const lines = (match.events || []).filter((event) => EVENT_LABEL[event.type]).map((event) => `<li><span class="min">${event.minute ?? '–'}'</span><span class="kind ${esc(event.type)}">${EVENT_LABEL[event.type]}</span><span>${esc(event.playerName || '')} ${esc(event.detail || '')}</span></li>`).join('');
  const stats = rows.map(([label, value]) => `<li><span class="min"></span><span class="kind">${esc(label)}</span><span>${esc(value)}</span></li>`).join('');
  const place = [match.referee ? `Судья: ${esc(match.referee)}` : '', sheet.venue ? esc(sheet.venue) : ''].filter(Boolean).join(' · ');
  if (!place && !stats && !lines) return '<p class="muted">Протокол для этого матча не опубликован.</p>';
  return `${place ? `<p class="muted">${place}</p>` : ''}<ul class="protocol">${lines}${stats}</ul>`;
}

function shortName(name) {
  const parts = String(name || '').split(' ').filter(Boolean);
  const particle = ['van', 'de', 'di', 'da', 'del', 'dos', 'von', 'st'];
  if (parts.length > 1 && particle.includes(parts[parts.length - 2].toLowerCase())) return parts.slice(-2).join(' ');
  return parts.at(-1) || '';
}

function lineOf(position) {
  const value = String(position || '').toLowerCase();
  if (value.includes('goal') || value === 'gk') return 'gk';
  if (value.includes('def') || value === 'df') return 'df';
  if (value.includes('off') || value.includes('forw') || value.includes('strik') || value === 'fw') return 'fw';
  return 'mf';
}

function pickXi(players) {
  const buckets = { gk: [], df: [], mf: [], fw: [] };
  for (const player of players || []) buckets[lineOf(player.position)].push(player);
  const outfield = buckets.df.length + buckets.mf.length + buckets.fw.length;
  if (!outfield) return null;
  let df = Math.min(5, Math.max(3, Math.round((10 * buckets.df.length) / outfield)));
  let fw = Math.min(3, Math.max(buckets.fw.length ? 1 : 0, Math.round((10 * buckets.fw.length) / outfield)));
  let mf = 10 - df - fw;
  if (mf < 2) {
    df = Math.max(3, df - (2 - mf));
    mf = 10 - df - fw;
  }
  if (mf > 5) {
    fw = Math.min(3, fw + (mf - 5));
    mf = 10 - df - fw;
  }
  const fwList = [...buckets.fw];
  const mfList = [...buckets.mf];
  const dfList = [...buckets.df];
  const forwards = fwList.splice(0, fw);
  const mids = mfList.splice(0, mf);
  const defs = dfList.splice(0, df);
  const reserve = [...dfList, ...mfList, ...fwList];
  const fill = (line, count) => {
    while (line.length < count && reserve.length) line.push(reserve.shift());
  };
  fill(defs, df);
  fill(mids, mf);
  fill(forwards, fw);
  const keeper = buckets.gk.slice(0, 1);
  if (defs.length + mids.length + forwards.length < 8) return null;
  return { shape: `${defs.length}-${mids.length}-${forwards.length}`, rows: [forwards, mids, defs, keeper] };
}

function pitch(side) {
  if (!side) return '';
  const xi = pickXi(side.players);
  const head = `<h3>${crest(side.badge, side.name)} ${esc(side.name)}</h3>`;
  if (!xi) return `<div>${head}<p class="muted">Состав не опубликован</p></div>`;
  const rows = xi.rows.filter((row) => row.length).map((row) => `<div class="pitch-row">${row.map((player) => `<div class="player-dot" title="${esc(player.name)}"><i>${esc(shortName(player.name).slice(0, 1))}</i><span>${esc(shortName(player.name))}</span></div>`).join('')}</div>`).join('');
  return `<div>${head}<p class="muted">Схема ${xi.shape}</p><div class="pitch">${rows}</div></div>`;
}

function arena(match) {
  const stadium = match.homeTeam?.stadium;
  const name = match.protocol?.venue || stadium?.name;
  if (!name) return '';
  const extra = [stadium?.city, stadium?.capacity ? `${Number(stadium.capacity).toLocaleString('ru-RU')} мест` : ''].filter(Boolean).join(' · ');
  return `<p class="arena">Арена: ${esc(name)}${extra ? ` <span class="muted">${esc(extra)}</span>` : ''}</p>`;
}

export function matchCard(json) {
  const match = json?.data?.match;
  if (!match) return `${errors(json)}<p>Матч не найден</p>`;
  return `${errors(json)}<article class="card">
    <p class="muted">${esc(match.season?.league?.name || '')} ${esc(match.season?.label || '')} · ${esc(match.status)}</p>
    <div class="board">
      <div class="side">${crest(match.homeTeam?.badge, match.homeName)}<strong>${esc(match.homeName)}</strong></div>
      <div class="score">${match.homeGoals ?? '–'}:${match.awayGoals ?? '–'}</div>
      <div class="side away"><strong>${esc(match.awayName)}</strong>${crest(match.awayTeam?.badge, match.awayName)}</div>
    </div>
    ${arena(match)}
    <p class="links"><a class="yt" href="${esc(reviewUrl(match))}" target="_blank" rel="noopener">Обзор на YouTube</a>${channelLink(match.homeTeam)}${channelLink(match.awayTeam)}</p>
    <h3>Протокол</h3>
    ${protocolSheet(match)}
    <h3>Стартовые составы</h3>
    <div class="grid pitches">${pitch(match.homeTeam)}${pitch(match.awayTeam)}</div>
    <details class="notes">
      <summary>Мои пометки</summary>
      <form id="fav">${match.favorite ? `<p>В избранном${match.favorite.note ? `: ${esc(match.favorite.note)}` : ''}</p><button data-del-fav="${esc(match.favorite.id)}" type="button">Убрать</button>` : `<input name="note" placeholder="Заметка к избранному" /><button>В избранное</button>`}</form>
      <form id="note"><textarea name="body" placeholder="Личная заметка">${esc(match.notes?.[0]?.body || '')}</textarea><button>Сохранить</button></form>
      <form id="comment"><input name="body" placeholder="Комментарий" required /><button>Отправить</button></form>
      <ul>${(match.comments || []).map((comment) => `<li>${esc(comment.body)} <button type="button" data-del-comment="${esc(comment.id)}">×</button></li>`).join('')}</ul>
    </details>
  </article>`;
}

export function teamList(json) {
  const page = json?.data?.teams;
  const rows = (page?.items || []).map((team) => `<div class="row team-row">${crest(team.badge, team.name)}<strong>${esc(team.name)}</strong><span class="muted">${esc(team.country || '')} · ${esc(team.stadium?.name || '')}</span></div>`).join('') || '<p class="muted">Ничего не найдено</p>';
  return `${errors(json)}<form id="team-search" class="card"><input name="search" placeholder="Поиск команды, FTS" /><button>Искать</button></form><div class="card"><p class="muted">Найдено ${page?.total ?? 0}</p>${rows}</div>`;
}

export function favorites(json) {
  const rows = (json?.data?.favorites || []).map((item) => `<div class="row"><a href="#/match/${item.match?.id}">Матч ${item.match?.homeName || item.match?.id} — ${item.match?.awayName || ''}</a><span>${item.note || ''}</span><button type="button" data-del-fav="${item.id}">Удалить</button></div>`).join('') || '<p class="muted">Пока пусто</p>';
  return `${errors(json)}<div class="card">${rows}</div>`;
}

export function builder(query, result) {
  const boxes = ['utcDate', 'status', 'homeGoals', 'awayGoals', 'source', 'homeName', 'awayName']
    .map((field) => `<label><input type="checkbox" name="field" value="${field}" checked /> ${field}</label>`).join('');
  return `<form id="builder" class="card">${boxes}
    <label><input type="checkbox" name="withPlayers" checked /> @include players</label>
    <label><input type="checkbox" name="skipVenue" /> @skip stadium</label>
    <button>Выполнить</button></form>
    <pre id="query-preview">${query}</pre>
    <pre>${result || ''}</pre>`;
}

export function live(json, score) {
  const options = (json?.data?.liveMatches || []).map((match) => `<option value="${match.id}">${match.homeName} — ${match.awayName}</option>`).join('');
  const view = score ? `<p class="score">${score.homeGoals}:${score.awayGoals}</p><p>${score.homeName} — ${score.awayName}</p><p class="muted">${score.status} · ${score.minute}'</p>` : '<p class="muted">Ожидание события подписки…</p>';
  return `${errors(json)}<p class="muted">Повтор недавнего матча: счёт доходит до реального и останавливается.</p><form id="live-pick" class="card"><select name="matchId">${options}</select><button>Смотреть</button></form><div class="card">${view}</div>`;
}
