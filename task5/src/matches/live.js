const games = new Map();
const listeners = new Set();

export function seedLive(db) {
  const rows = db.prepare(`
    SELECT id, home_name, away_name, home_goals, away_goals
    FROM matches
    WHERE status = 'FINISHED' AND home_goals IS NOT NULL AND away_goals IS NOT NULL
    ORDER BY utc_date DESC LIMIT 4`).all();
  const picked = rows.length ? rows : [{ id: 'demo', home_name: 'Home FC', away_name: 'Away FC', home_goals: 0, away_goals: 0 }];
  for (const row of picked) {
    games.set(String(row.id), {
      matchId: String(row.id),
      minute: 0,
      homeGoals: 0,
      awayGoals: 0,
      finalHome: row.home_goals || 0,
      finalAway: row.away_goals || 0,
      status: 'LIVE',
      homeName: row.home_name,
      awayName: row.away_name,
    });
  }
}

export function onScore(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const game of games.values()) {
    for (const listener of listeners) listener({ ...game });
  }
}

export function startLive() {
  emit();
  const timer = setInterval(() => {
    for (const game of games.values()) {
      if (game.status === 'FINISHED') continue;
      game.minute = Math.min(90, game.minute + 1);
      const progress = game.minute / 90;
      game.homeGoals = Math.min(game.finalHome, Math.round(game.finalHome * progress));
      game.awayGoals = Math.min(game.finalAway, Math.round(game.finalAway * progress));
      if (game.minute >= 90) {
        game.homeGoals = game.finalHome;
        game.awayGoals = game.finalAway;
        game.status = 'FINISHED';
      }
    }
    emit();
  }, 1000);
  timer.unref();
}

export function liveMatchIds() {
  return [...games.keys()];
}

export function pendingLiveIds() {
  return [...games.values()]
    .filter((game) => game.status !== 'FINISHED' && game.matchId !== 'demo')
    .map((game) => game.matchId);
}
