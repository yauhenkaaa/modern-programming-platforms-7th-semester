CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY,
  from_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY,
  size INT NOT NULL,
  komi DOUBLE PRECISION NOT NULL,
  black_id UUID NOT NULL REFERENCES users(id),
  white_id UUID NOT NULL REFERENCES users(id),
  moves JSONB NOT NULL DEFAULT '[]',
  board JSONB NOT NULL,
  forbidden_hash TEXT,
  phase TEXT NOT NULL,
  rev INT NOT NULL,
  turn INT,
  consecutive_passes INT NOT NULL DEFAULT 0,
  prisoners JSONB NOT NULL,
  dead_marks JSONB NOT NULL,
  confirms JSONB NOT NULL,
  score_black DOUBLE PRECISION,
  score_white DOUBLE PRECISION,
  winner TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS games_black_idx ON games (black_id);
CREATE INDEX IF NOT EXISTS games_white_idx ON games (white_id);
CREATE INDEX IF NOT EXISTS games_phase_idx ON games (phase);
