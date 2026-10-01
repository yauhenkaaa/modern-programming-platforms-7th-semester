import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from './api.js';

const FILTER_GROUPS = [
  ['Игрок', [
    ['q', 'Имя'], ['ageMin', 'Возраст от'], ['ageMax', 'Возраст до'], ['nationId', 'Страна'],
    ['position', 'Позиция'], ['clubId', 'Клуб'], ['hand', 'Хват'], ['isUfa', 'UFA']
  ]],
  ['Отчёт', [
    ['gradeMin', 'Оценка от'], ['gradeMax', 'Оценка до'], ['recommendation', 'Рекомендация'],
    ['matchesObservedMin', 'Матчей от'], ['hasDocument', 'Документ']
  ]],
  ['Статистика сезона', [
    ['goalsMin', 'Голы от'], ['goalsMax', 'Голы до'], ['assistsMin', 'Передачи от'], ['assistsMax', 'Передачи до'],
    ['pointsMin', 'Очки от'], ['pointsMax', 'Очки до'], ['pimMin', 'Штраф от'], ['pimMax', 'Штраф до'],
    ['plusMinusMin', '+/- от'], ['plusMinusMax', '+/- до'], ['faceoffPctMin', '% вбр. от'], ['faceoffPctMax', '% вбр. до'],
    ['savePctMin', '% отр. от'], ['savePctMax', '% отр. до'], ['gaaMin', 'GAA от'], ['gaaMax', 'GAA до'],
    ['gpMin', 'Игры от'], ['gpMax', 'Игры до']
  ]]
];
const FILTERS = FILTER_GROUPS.flatMap(([, fields]) => fields);
const SORTS = [
  ['reportDate', 'дата отчёта'], ['overallGrade', 'оценка'], ['surname', 'фамилия'],
  ['points', 'очки'], ['goals', 'голы'], ['savePct', '% отражённых'], ['gaa', 'GAA']
];
const PAIRS = FILTERS.filter(([key]) => key.endsWith('Min')).map(([key]) => [key, key.replace(/Min$/, 'Max')]);
const GRADES = [
  ['skating', 'Катание'], ['shooting', 'Бросок'], ['passing', 'Пас'], ['hockeyIq', 'Мышление'],
  ['physicality', 'Сила'], ['defensivePlay', 'Оборона'], ['discipline', 'Дисциплина'], ['potential', 'Потенциал']
];
const EMPTY = {
  playerId: '', scoutName: '', reportDate: new Date().toISOString().slice(0, 10), matchesObserved: '3',
  observedMatches: '', projection: '', strengths: '', weaknesses: '', summary: '',
  overallGrade: '5', recommendation: 'monitor', ...Object.fromEntries(GRADES.map(([key]) => [key, '5']))
};
const REC = { sign: 'подписать', monitor: 'наблюдать', pass: 'отказать' };
const CLUB_COLORS = {
  'Динамо Минск': '#1F4E9B', 'Авангард': '#E10600', 'Металлург Магнитогорск': '#163A5F',
  'Трактор': '#1A1A1A', 'ЦСКА': '#D21034', 'Автомобилист': '#F26A21', 'Динамо Москва': '#0047BB',
  'Ак Барс': '#009B4D', 'Локомотив': '#E03C31', 'Торпедо': '#003366', 'Северсталь': '#F15A22',
  'Нефтехимик': '#0057B8', 'Спартак': '#E10600', 'Адмирал': '#0A2F5C', 'Шанхай Драгонс': '#C8102E',
  'Лада': '#005EB8', 'Салават Юлаев': '#0B7A3B', 'СКА': '#D52B1E', 'Барыс': '#00A3E0',
  'Сибирь': '#003DA5', 'ХК Сочи': '#0077C8', 'Амур': '#F58220'
};
function clubColor(name) { return CLUB_COLORS[name] || '#8a8f94'; }

function readUser() {
  try { return JSON.parse(sessionStorage.getItem('user') || 'null'); } catch { return null; }
}

function canCreate(user) {
  return Boolean(user && (user.role === 'scout' || user.role === 'admin'));
}

function canMutate(user, authorId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'scout' && authorId != null && authorId === user.id;
}

function options(dictionaries, key) {
  if (!dictionaries) return null;
  if (key === 'nationId') return dictionaries.nations.map((item) => [item.id, item.name]);
  if (key === 'clubId') return dictionaries.clubs.map((item) => [item.id, item.name]);
  if (key === 'position') return dictionaries.positions.map((item) => [item, item]);
  if (key === 'hand') return dictionaries.hands.map((item) => [item, item]);
  if (key === 'recommendation') return dictionaries.recommendation.map((item) => [item, REC[item]]);
  if (key === 'isUfa' || key === 'hasDocument') return [['true', 'да'], ['false', 'нет']];
  return null;
}

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = readUser();
  const path = location.pathname;
  const publicPage = path === '/login' || path === '/forgot' || path === '/reset';
  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ключ уже отозван */ }
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    navigate('/login');
  }
  if (!user && !publicPage) return <Navigate to="/login" replace />;
  if (user && (path === '/login' || path === '/forgot')) return <Navigate to="/reports" replace />;
  return (
    <>
      <header>
        <strong>Скаутинг КХЛ</strong>
        {user && <>
          <NavLink to="/reports" end>Отчёты</NavLink>
          {canCreate(user) && <NavLink to="/reports/new">Новый отчёт</NavLink>}
          <NavLink to="/sessions">Сессии</NavLink>
          <span className="who">{user.email} · {user.role}</span>
          <button type="button" onClick={logout}>Выход</button>
        </>}
      </header>
      <main>
      <Routes>
          <Route path="/" element={<Navigate to="/reports" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/reset" element={<ResetPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/new" element={<ReportForm />} />
          <Route path="/reports/:id/edit" element={<ReportForm />} />
          <Route path="/reports/:id" element={<ReportPage />} />
          <Route path="/players/:id" element={<PlayerPage />} />
          <Route path="*" element={<p>Страница не найдена</p>} />
      </Routes>
      </main>
    </>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      sessionStorage.setItem('token', data.token);
      sessionStorage.setItem('user', JSON.stringify({ id: data.id, email: data.email, role: data.role }));
      navigate('/reports');
    } catch (err) { setError(err.message); }
  }
  return (
    <form onSubmit={submit}>
      <h1>Вход</h1>
      {error && <p className="error">{error}</p>}
      <label>Почта<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <p className="row"><button type="submit">Войти</button><Link to="/forgot">Забыли пароль</Link></p>
      <p className="meta">viewer@local.test / viewer · scout@local.test / scout · admin@local.test / admin</p>
    </form>
  );
}

function ForgotPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      setSent(true);
    } catch (err) { setError(err.message); }
  }
  return (
    <form onSubmit={submit}>
      <h1>Восстановление доступа</h1>
      {error && <p className="error">{error}</p>}
      {sent ? <p>Если адрес зарегистрирован, письмо отправлено. Ящик: http://localhost:8025</p> : (
        <>
          <label>Почта<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <p><button type="submit">Отправить ссылку</button></p>
        </>
      )}
      <p><Link to="/login">Ко входу</Link></p>
    </form>
  );
}

function ResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: params.get('token') || '', password })
      });
      navigate('/login');
    } catch (err) { setError(err.message); }
  }
  return (
    <form onSubmit={submit}>
      <h1>Новый пароль</h1>
      {error && <p className="error">{error}</p>}
      <label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={4} /></label>
      <p><button type="submit">Сохранить</button></p>
    </form>
  );
}

function SessionsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  function load() {
    return api('/api/auth/sessions').then((value) => setItems(value.items)).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);
  async function revoke(id) {
    setError('');
    try {
      await api('/api/auth/sessions/' + id, { method: 'DELETE' });
      await load();
    } catch (err) { setError(err.message); }
  }
  return (
    <>
      <h1>Активные подключения</h1>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p>Загрузка…</p>}
      {items && items.length === 0 && <p>Активных сессий нет</p>}
      {items && items.map((item) => (
        <article key={item.id}>
          <p><strong>{item.email}</strong> · {item.role}{item.current ? ' · текущая' : ''}</p>
          <p className="meta">{item.ip || 'без адреса'} · до {item.expiresAt}</p>
          <button type="button" onClick={() => revoke(item.id)}>Отозвать</button>
        </article>
      ))}
    </>
  );
}

function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => Object.fromEntries(params));
  const [data, setData] = useState(null);
  const [leaders, setLeaders] = useState(null);
  const [dictionaries, setDictionaries] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => setDraft(Object.fromEntries(params)), [params]);
  useEffect(() => {
    let ignore = false;
    api('/api/dictionaries').then((value) => { if (!ignore) setDictionaries(value); }).catch((err) => setError(err.message));
    api('/api/players/leaders').then((value) => { if (!ignore) setLeaders(value); }).catch(() => {});
    return () => { ignore = true; };
  }, []);
  useEffect(() => {
    let ignore = false;
    setError('');
    api('/api/reports' + qs(Object.fromEntries(params))).then((value) => { if (!ignore) setData(value); }).catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [params]);
  function apply(event) {
    event.preventDefault();
    for (const [minKey, maxKey] of PAIRS) {
      if (draft[minKey] && draft[maxKey] && Number(draft[minKey]) > Number(draft[maxKey])) {
        setError('Диапазон «' + minKey + '» больше «' + maxKey + '»');
        return;
      }
    }
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(draft)) if (value && key !== 'page') next.set(key, value);
    setParams(next);
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <>
      {leaders && (
        <section>
          <h2>Лидеры сезона</h2>
          <div className="leaders">
            {[['Очки', leaders.points], ['Очки защитников', leaders.defensemen], ['% отражённых', leaders.savePct]].map(([title, items]) => (
              <article key={title}>
                <strong>{title}</strong>
                <ol>{(items || []).map((item) => <li key={item.id}><Link to={'/players/' + item.id}>{item.fullName}</Link> — {item.value} ({item.club || 'без клуба'})</li>)}</ol>
              </article>
            ))}
          </div>
        </section>
      )}
      <form onSubmit={apply}>
        {FILTER_GROUPS.map(([title, fields]) => (
          <fieldset key={title}>
            <legend>{title}</legend>
            <div className="grid">
              {fields.map(([key, label]) => {
                const list = options(dictionaries, key);
                return (
                  <label key={key}>{label}
                    {list ? (
                      <select value={draft[key] || ''} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}>
                        <option value="">все</option>
                        {list.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                      </select>
                    ) : <input value={draft[key] || ''} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <fieldset>
          <legend>Порядок списка</legend>
          <div className="grid">
            <label>Сортировка
              <select value={draft.sort || 'reportDate'} onChange={(event) => setDraft({ ...draft, sort: event.target.value })}>
                {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>Порядок
              <select value={draft.order || 'desc'} onChange={(event) => setDraft({ ...draft, order: event.target.value })}>
                <option value="desc">по убыванию</option>
                <option value="asc">по возрастанию</option>
              </select>
            </label>
          </div>
        </fieldset>
        <p className="row">
          <button type="submit">Применить</button>
          <button type="button" className="ghost" onClick={() => { setDraft({}); setParams(new URLSearchParams()); }}>Сбросить</button>
        </p>
      </form>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p>Загрузка…</p>}
      {data && data.items.length === 0 && <p>Отчётов нет</p>}
      {data && data.items.length > 0 && <h2>Отчёты</h2>}
      {data && data.items.map((report) => (
        <article key={report.id} className="club-block" style={{ borderColor: clubColor(report.player.club?.name) }}>
          <Link to={'/reports/' + report.id}><strong>{report.player.fullName}</strong></Link>
          <p className="meta">{report.player.club?.name || 'без клуба'} · {report.player.position} · {report.reportDate}</p>
          <p className="meta">Оценка {report.overallGrade} · {REC[report.recommendation]} · матчей {report.matchesObserved}</p>
          <div>{report.summary}</div>
        </article>
      ))}
      {data && pages > 1 && (
        <p className="row">
          <button type="button" disabled={data.page <= 1} onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.set('page', String(data.page - 1)); return next; })}>Назад</button>
          <span>{data.page} / {pages}</span>
          <button type="button" disabled={data.page >= pages} onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.set('page', String(data.page + 1)); return next; })}>Дальше</button>
        </p>
      )}
    </>
  );
}

function ReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/reports/' + id).then(setReport).catch((err) => setError(err.message)); }, [id]);
  async function remove() {
    if (!report || !confirm('Удалить отчёт по игроку ' + report.player.fullName + '?')) return;
    try { await api('/api/reports/' + id, { method: 'DELETE' }); navigate('/reports'); }
    catch (err) { if (err.status === 404) navigate('/reports'); else setError(err.message); }
  }
  if (error) return <p className="error">{error}</p>;
  if (!report) return <p>Загрузка…</p>;
  const stats = report.player.currentSeasonStats?.[0];
  return (
    <article className="club-block" style={{ borderColor: clubColor(report.player.club?.name) }}>
      <h1><Link to={'/players/' + report.player.id}>{report.player.fullName}</Link></h1>
      <div className="facts">
        {[['Позиция', report.player.position], ['Возраст', report.player.age + ' лет'], ['Страна', report.player.nation?.name]].map(([label, value]) => (
          <div key={label}><span>{label}</span>{value}</div>
        ))}
        <div><span>Клуб</span>{report.player.club?.name || 'без клуба'}</div>
      </div>
      <h2>Наблюдение</h2>
      <p>Матчей просмотрено: {report.matchesObserved}</p>
      <p>{report.observedMatches || 'Список матчей не указан'}</p>
      <h2>Оценки</h2>
      <div className="grades">{GRADES.map(([key, label]) => <span key={key}>{label} {report[key]}</span>)}</div>
      <p className="meta">Итог {report.overallGrade} · {REC[report.recommendation]}{report.projection ? ' · ' + report.projection : ''}</p>
      <h2>Заключение</h2>
      <p><strong>Сильные стороны.</strong> {report.strengths || '—'}</p>
      <p><strong>Слабые стороны.</strong> {report.weaknesses || '—'}</p>
      <p>{report.summary || 'Резюме нет'}</p>
      {stats && (
        <>
          <h2>Текущий сезон</h2>
          <div className="facts">
            {[['Игры', stats.gp], ['Голы', stats.goals], ['Передачи', stats.assists], ['Очки', stats.points], ['+/-', stats.plusMinus]].map(([label, value]) => (
              <div key={label}><span>{label}</span>{value}</div>
            ))}
            {stats.savePct != null && <div><span>% отражённых</span>{stats.savePct}</div>}
          </div>
        </>
      )}
      <h2>Документ</h2>
      <p>{report.document ? <a href={report.document.url}>{report.document.originalName}</a> : 'Документ не приложен'}</p>
      <p className="row">
        {canMutate(readUser(), report.authorId) && <>
          <Link className="button" to={'/reports/' + id + '/edit'}>Изменить</Link>
          <button type="button" onClick={remove}>Удалить</button>
        </>}
      </p>
    </article>
  );
}

function ReportForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [fields, setFields] = useState(EMPTY);
  const [initial, setInitial] = useState(EMPTY);
  const [playerLabel, setPlayerLabel] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [file, setFile] = useState(null);
  const [removeDoc, setRemoveDoc] = useState(false);
  const [hasDoc, setHasDoc] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [authorId, setAuthorId] = useState(undefined);
  const user = readUser();
  useEffect(() => {
    if (!id) return;
    api('/api/reports/' + id).then((report) => {
      const next = { ...EMPTY };
      for (const key of Object.keys(EMPTY)) next[key] = report[key] ?? '';
      next.playerId = String(report.playerId);
      setFields(next); setInitial(next); setPlayerLabel(report.player.fullName); setHasDoc(Boolean(report.document)); setAuthorId(report.authorId ?? null);
    }).catch((err) => setError(err.message));
  }, [id]);
  useEffect(() => {
    if (playerLabel.trim().length < 2 || fields.playerId && playerLabel.includes(' ')) return undefined;
    let ignore = false;
    api('/api/players' + qs({ q: playerLabel, limit: 8 })).then((value) => { if (!ignore) setSuggestions(value.items); }).catch(() => {});
    return () => { ignore = true; };
  }, [playerLabel, fields.playerId]);
  function set(key, value) { setFields((prev) => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    if (Number(fields.matchesObserved) < 3) { setFieldErrors({ matchesObserved: 'Минимум 3 матча' }); return; }
    if (file && file.size > 10 * 1024 * 1024) { setFieldErrors({ document: 'Файл больше 10 МБ' }); return; }
    const data = new FormData();
    const source = id ? Object.fromEntries(Object.keys(EMPTY).filter((key) => String(fields[key] ?? '') !== String(initial[key] ?? '')).map((key) => [key, fields[key]])) : fields;
    for (const [key, value] of Object.entries(source)) data.append(key, value ?? '');
    if (file) data.append('document', file);
    if (id && removeDoc) data.append('removeDocument', 'true');
    if (id && [...data.keys()].length === 0) { setError('Нет изменений'); return; }
    try {
      const saved = await api('/api/reports' + (id ? '/' + id : ''), { method: id ? 'PATCH' : 'POST', body: data });
      navigate('/reports/' + saved.id);
    } catch (err) {
      setError(err.message);
      setFieldErrors(Object.fromEntries((err.details || []).map((item) => [item.field, item.message])));
    }
  }
  if (!id && !canCreate(user)) return <p className="error">Недостаточно прав</p>;
  if (id && authorId !== undefined && !canMutate(user, authorId)) return <p className="error">Недостаточно прав</p>;
  return (
    <form onSubmit={submit}>
      <h1>{id ? 'Правка отчёта' : 'Новый отчёт'}</h1>
      {error && <p className="error">{error}</p>}
      <fieldset className="suggest">
        <legend>Игрок</legend>
        <label>Поиск
          <input value={playerLabel} onChange={(event) => { setPlayerLabel(event.target.value); set('playerId', ''); }} required />
        </label>
        {suggestions.length > 0 && !fields.playerId && (
          <ul>{suggestions.map((item) => (
            <li key={item.id} onClick={() => { set('playerId', String(item.id)); setPlayerLabel(item.fullName); setSuggestions([]); }}>{item.fullName} · {item.club?.name}</li>
          ))}</ul>
        )}
        {fieldErrors.playerId && <span className="error">{fieldErrors.playerId}</span>}
      </fieldset>
      <fieldset>
        <legend>Сведения</legend>
        <div className="grid">
          {[['scoutName', 'Скаут'], ['reportDate', 'Дата', 'date'], ['matchesObserved', 'Матчей', 'number']].map(([key, label, type]) => (
            <label key={key}>{label}<input type={type || 'text'} value={fields[key]} onChange={(event) => set(key, event.target.value)} required />{fieldErrors[key] && <span className="error">{fieldErrors[key]}</span>}</label>
          ))}
          <label>Рекомендация
            <select value={fields.recommendation} onChange={(event) => set('recommendation', event.target.value)}>
              {Object.entries(REC).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Оценки</legend>
        <div className="grid">
          {GRADES.map(([key, label]) => (
            <label key={key}>{label}<input type="number" min="1" max="10" value={fields[key]} onChange={(event) => set(key, event.target.value)} required /></label>
          ))}
          <label>Итог<input type="number" value={fields.overallGrade} onChange={(event) => set('overallGrade', event.target.value)} required />{fieldErrors.overallGrade && <span className="error">{fieldErrors.overallGrade}</span>}</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Текст</legend>
        {[['observedMatches', 'Просмотренные матчи'], ['projection', 'Прогноз'], ['strengths', 'Сильные стороны'], ['weaknesses', 'Слабые стороны'], ['summary', 'Резюме']].map(([key, label]) => (
          <label key={key}>{label}<textarea value={fields[key]} onChange={(event) => set(key, event.target.value)} />{fieldErrors[key] && <span className="error">{fieldErrors[key]}</span>}</label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Документ</legend>
        <label>Файл <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        {fieldErrors.document && <p className="error">{fieldErrors.document}</p>}
        {id && hasDoc && <label><input type="checkbox" checked={removeDoc} onChange={(event) => setRemoveDoc(event.target.checked)} /> Удалить текущий документ</label>}
      </fieldset>
      <p><button type="submit">Сохранить</button></p>
    </form>
  );
}

function PlayerPage() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/players/' + id).then(setPlayer).catch((err) => setError(err.message)); }, [id]);
  if (error) return <p className="error">{error}</p>;
  if (!player) return <p>Загрузка…</p>;
  const table = (rows) => (
    <table>
      <thead><tr><th>Сезон</th><th>Клуб</th><th>GP</th><th>G</th><th>A</th><th>PTS</th><th>+/-</th><th>%Sv</th><th>GAA</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td>{row.season.title} {row.stage || ''}</td><td>{row.club?.name}</td><td>{row.gp}</td><td>{row.goals}</td><td>{row.assists}</td><td>{row.points}</td><td>{row.plusMinus}</td><td>{row.savePct ?? '—'}</td><td>{row.gaa ?? '—'}</td></tr>)}</tbody>
    </table>
  );
  return (
    <article>
      <section className="club-block" style={{ borderColor: clubColor(player.club?.name) }}>
      <h1>{player.fullName}</h1>
      <div className="facts">
        {[['Позиция', player.position], ['Хват', player.hand], ['Номер', player.jerseyNumber], ['Возраст', player.age + ' лет'], ['Рост / вес', player.heightCm + ' / ' + player.weightKg], ['Страна', player.nation?.name]].map(([label, value]) => (
          <div key={label}><span>{label}</span>{value}</div>
        ))}
        <div><span>Клуб</span>{player.club?.name || 'без клуба'}</div>
      </div>
      <p>{player.bio}</p>
      </section>
      <h2>Текущий сезон</h2>
      {player.currentSeasonStats?.length ? table(player.currentSeasonStats) : <p>Нет статистики</p>}
      <h2>История</h2>
      {player.seasonHistory?.length ? table(player.seasonHistory) : <p>Нет истории</p>}
    </article>
  );
}

export default function App() { return <Layout />; }
