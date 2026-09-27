CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE DOMAIN report_recommendation AS TEXT CHECK (VALUE IN ('sign', 'monitor', 'pass'));
CREATE DOMAIN scout_grade AS SMALLINT CHECK (VALUE BETWEEN 1 AND 10);

CREATE TABLE nations (
  id SERIAL PRIMARY KEY,
  nation_name TEXT NOT NULL UNIQUE CHECK (btrim(nation_name) <> ''),
  iso_code CHAR(3) UNIQUE CHECK (iso_code IS NULL OR iso_code ~ '^[A-Z]{3}$'),
  flag_url TEXT
);

CREATE TABLE clubs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  city TEXT NOT NULL CHECK (btrim(city) <> ''),
  logo TEXT,
  arena TEXT NOT NULL CHECK (btrim(arena) <> ''),
  bio TEXT,
  division TEXT CHECK (division IN ('Боброва', 'Тарасова', 'Харламова', 'Чернышёва')),
  conference TEXT CHECK (conference IN ('Запад', 'Восток')),
  CHECK (
    division IS NULL OR conference IS NULL
    OR (division IN ('Боброва', 'Тарасова') AND conference = 'Запад')
    OR (division IN ('Харламова', 'Чернышёва') AND conference = 'Восток')
  )
);

CREATE TABLE seasons (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL UNIQUE CHECK (title ~ '^\d{4}/\d{4}$'),
  start_year SMALLINT NOT NULL CHECK (start_year BETWEEN 2008 AND 2100),
  end_year SMALLINT NOT NULL CHECK (end_year BETWEEN 2009 AND 2101),
  CHECK (end_year = start_year + 1),
  CHECK (title = start_year::text || '/' || end_year::text)
);

CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  patronymic TEXT CHECK (patronymic IS NULL OR btrim(patronymic) <> ''),
  surname TEXT NOT NULL CHECK (btrim(surname) <> ''),
  nation_id INTEGER NOT NULL REFERENCES nations (id) ON DELETE RESTRICT,
  dob DATE NOT NULL CHECK (dob BETWEEN DATE '1950-01-01' AND DATE '2012-12-31'),
  current_club_id INTEGER REFERENCES clubs (id) ON DELETE SET NULL,
  position TEXT NOT NULL CHECK (position IN ('вратарь', 'защитник', 'нападающий')),
  hand TEXT NOT NULL CHECK (hand IN ('левый', 'правый')),
  jersey_number SMALLINT CHECK (jersey_number BETWEEN 1 AND 99),
  height_cm SMALLINT CHECK (height_cm BETWEEN 150 AND 220),
  weight_kg SMALLINT CHECK (weight_kg BETWEEN 50 AND 150),
  photo TEXT,
  bio TEXT,
  is_ufa BOOLEAN NOT NULL DEFAULT false,
  contract_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (surname, name, dob),
  CHECK (NOT is_ufa OR contract_until IS NULL)
);

CREATE TRIGGER players_set_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE current_season_stats (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs (id) ON DELETE RESTRICT,
  season_id INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  gp SMALLINT NOT NULL DEFAULT 0 CHECK (gp >= 0),
  goals SMALLINT NOT NULL DEFAULT 0 CHECK (goals >= 0),
  assists SMALLINT NOT NULL DEFAULT 0 CHECK (assists >= 0),
  points SMALLINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  plus_minus SMALLINT NOT NULL DEFAULT 0,
  pim SMALLINT NOT NULL DEFAULT 0 CHECK (pim >= 0),
  sog SMALLINT NOT NULL DEFAULT 0 CHECK (sog >= 0),
  shooting_pct NUMERIC(4, 1) CHECK (shooting_pct BETWEEN 0 AND 100),
  faceoffs INTEGER NOT NULL DEFAULT 0 CHECK (faceoffs >= 0),
  faceoffs_won INTEGER NOT NULL DEFAULT 0 CHECK (faceoffs_won >= 0),
  faceoff_pct NUMERIC(4, 1) CHECK (faceoff_pct BETWEEN 0 AND 100),
  toi_seconds INTEGER NOT NULL DEFAULT 0 CHECK (toi_seconds >= 0),
  ppg SMALLINT NOT NULL DEFAULT 0 CHECK (ppg >= 0),
  shg SMALLINT NOT NULL DEFAULT 0 CHECK (shg >= 0),
  gwg SMALLINT NOT NULL DEFAULT 0 CHECK (gwg >= 0),
  esg SMALLINT NOT NULL DEFAULT 0 CHECK (esg >= 0),
  gaa NUMERIC(4, 2) CHECK (gaa >= 0),
  save_pct NUMERIC(4, 1) CHECK (save_pct BETWEEN 0 AND 100),
  saves SMALLINT CHECK (saves >= 0),
  shots_against SMALLINT CHECK (shots_against >= 0),
  shutouts SMALLINT CHECK (shutouts >= 0),
  wins SMALLINT CHECK (wins >= 0),
  losses SMALLINT CHECK (losses >= 0),
  ot_losses SMALLINT CHECK (ot_losses >= 0),
  extra_stats JSONB NOT NULL DEFAULT '{}',
  UNIQUE (player_id, season_id, club_id),
  CHECK (points = goals + assists),
  CHECK (faceoffs_won <= faceoffs),
  CHECK (ppg + shg + esg <= goals),
  CHECK (gwg <= goals),
  CHECK (saves IS NULL OR shots_against IS NULL OR saves <= shots_against),
  CHECK (shutouts IS NULL OR shutouts <= gp),
  CHECK (num_nulls(gaa, save_pct, saves, shots_against, shutouts, wins, losses, ot_losses) IN (0, 8)),
  CHECK (jsonb_typeof(extra_stats) = 'object')
);

CREATE TABLE all_time_stats (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs (id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('regular', 'playoff')),
  gp SMALLINT NOT NULL DEFAULT 0 CHECK (gp >= 0),
  goals SMALLINT NOT NULL DEFAULT 0 CHECK (goals >= 0),
  assists SMALLINT NOT NULL DEFAULT 0 CHECK (assists >= 0),
  points SMALLINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  plus_minus SMALLINT NOT NULL DEFAULT 0,
  pim SMALLINT NOT NULL DEFAULT 0 CHECK (pim >= 0),
  sog SMALLINT NOT NULL DEFAULT 0 CHECK (sog >= 0),
  shooting_pct NUMERIC(4, 1) CHECK (shooting_pct BETWEEN 0 AND 100),
  faceoffs INTEGER NOT NULL DEFAULT 0 CHECK (faceoffs >= 0),
  faceoffs_won INTEGER NOT NULL DEFAULT 0 CHECK (faceoffs_won >= 0),
  faceoff_pct NUMERIC(4, 1) CHECK (faceoff_pct BETWEEN 0 AND 100),
  toi_seconds INTEGER NOT NULL DEFAULT 0 CHECK (toi_seconds >= 0),
  ppg SMALLINT NOT NULL DEFAULT 0 CHECK (ppg >= 0),
  shg SMALLINT NOT NULL DEFAULT 0 CHECK (shg >= 0),
  gwg SMALLINT NOT NULL DEFAULT 0 CHECK (gwg >= 0),
  esg SMALLINT NOT NULL DEFAULT 0 CHECK (esg >= 0),
  gaa NUMERIC(4, 2) CHECK (gaa >= 0),
  save_pct NUMERIC(4, 1) CHECK (save_pct BETWEEN 0 AND 100),
  saves SMALLINT CHECK (saves >= 0),
  shots_against SMALLINT CHECK (shots_against >= 0),
  shutouts SMALLINT CHECK (shutouts >= 0),
  wins SMALLINT CHECK (wins >= 0),
  losses SMALLINT CHECK (losses >= 0),
  ot_losses SMALLINT CHECK (ot_losses >= 0),
  extra_stats JSONB NOT NULL DEFAULT '{}',
  bio TEXT,
  UNIQUE (player_id, season_id, club_id, stage),
  CHECK (points = goals + assists),
  CHECK (faceoffs_won <= faceoffs),
  CHECK (ppg + shg + esg <= goals),
  CHECK (gwg <= goals),
  CHECK (saves IS NULL OR shots_against IS NULL OR saves <= shots_against),
  CHECK (shutouts IS NULL OR shutouts <= gp),
  CHECK (num_nulls(gaa, save_pct, saves, shots_against, shutouts, wins, losses, ot_losses) IN (0, 8)),
  CHECK (jsonb_typeof(extra_stats) = 'object')
);

CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  scout_name TEXT NOT NULL CHECK (btrim(scout_name) <> '' AND length(scout_name) <= 120),
  report_date DATE NOT NULL CHECK (report_date BETWEEN DATE '2008-09-01' AND DATE '2100-01-01'),
  matches_observed SMALLINT NOT NULL CHECK (matches_observed >= 3),
  observed_matches TEXT,
  skating scout_grade NOT NULL,
  shooting scout_grade NOT NULL,
  passing scout_grade NOT NULL,
  hockey_iq scout_grade NOT NULL,
  physicality scout_grade NOT NULL,
  defensive_play scout_grade NOT NULL,
  discipline scout_grade NOT NULL,
  potential scout_grade NOT NULL,
  overall_grade NUMERIC(3, 1) NOT NULL CHECK (overall_grade BETWEEN 1.0 AND 10.0),
  recommendation report_recommendation NOT NULL,
  projection TEXT CHECK (projection IS NULL OR length(projection) <= 200),
  strengths TEXT,
  weaknesses TEXT,
  summary TEXT,
  document_path TEXT UNIQUE,
  document_original_name TEXT,
  document_mime TEXT,
  document_size_bytes INTEGER CHECK (document_size_bytes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (abs(overall_grade - (skating + shooting + passing + hockey_iq + physicality + defensive_play + discipline + potential)::NUMERIC / 8) <= 1.5),
  CHECK (num_nulls(document_path, document_original_name, document_mime, document_size_bytes) IN (0, 4)),
  CHECK (document_path IS NULL OR document_path ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  CHECK (document_path IS NULL OR document_path NOT LIKE '%..%'),
  CHECK (document_mime IS NULL OR document_mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  CHECK (updated_at >= created_at)
);

CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX players_surname_idx ON players (surname);
CREATE INDEX players_dob_idx ON players (dob);
CREATE INDEX players_nation_id_idx ON players (nation_id);
CREATE INDEX players_current_club_id_idx ON players (current_club_id);
CREATE INDEX players_position_idx ON players (position);
CREATE INDEX players_name_trgm_idx ON players USING gin (lower(surname || ' ' || name) gin_trgm_ops);
CREATE INDEX reports_player_id_idx ON reports (player_id);
CREATE INDEX reports_overall_grade_idx ON reports (overall_grade);
CREATE INDEX reports_report_date_idx ON reports (report_date DESC, id DESC);
CREATE INDEX css_season_points_idx ON current_season_stats (season_id, points);
CREATE INDEX css_save_pct_idx ON current_season_stats (save_pct) WHERE save_pct IS NOT NULL;
CREATE INDEX css_gaa_idx ON current_season_stats (gaa) WHERE gaa IS NOT NULL;
CREATE INDEX css_faceoff_pct_idx ON current_season_stats (faceoff_pct) WHERE faceoff_pct IS NOT NULL;
CREATE INDEX ats_player_idx ON all_time_stats (player_id, season_id);
