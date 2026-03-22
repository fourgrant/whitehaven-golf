-- ============================================================
-- Whitehaven Golf League — Supabase Schema
-- Run this in the Supabase SQL editor after creating your project
-- ============================================================

-- PLAYERS
CREATE TABLE IF NOT EXISTS players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  avg_score     numeric DEFAULT 40.0,
  rounds_played integer DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  base_avg      numeric,               -- historical avg before app tracking; used as blend seed
  base_rounds   integer NOT NULL DEFAULT 0, -- historical round count before app tracking
  created_at    timestamptz DEFAULT now()
);

-- ROUNDS
CREATE TABLE IF NOT EXISTS rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date             date NOT NULL,
  course           text NOT NULL DEFAULT 'Whitehaven',
  buyin_per_player numeric NOT NULL DEFAULT 12,
  cth_per_player   numeric NOT NULL DEFAULT 2,
  status           text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','in_progress','complete')),
  lead_commish_id  uuid REFERENCES players(id),
  team_scores      jsonb DEFAULT '{}'::jsonb,  -- map of team letter -> score, e.g. {"A":107,"B":112}
  created_at       timestamptz DEFAULT now()
);

-- ROUND_PLAYERS
CREATE TABLE IF NOT EXISTS round_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team        text,
  score       integer,
  holes_won   integer NOT NULL DEFAULT 0,
  cth_winner  boolean NOT NULL DEFAULT false,
  cth_count   integer NOT NULL DEFAULT 0,  -- # of CTH holes won this round (0, 1, or 2)
  paid_in     boolean NOT NULL DEFAULT false,
  paid_out    boolean NOT NULL DEFAULT false,
  UNIQUE(round_id, player_id)
);

-- ROUND_RESULTS
CREATE TABLE IF NOT EXISTS round_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_winnings  numeric NOT NULL DEFAULT 0,
  skin_winnings  numeric NOT NULL DEFAULT 0,
  cth_winnings   numeric NOT NULL DEFAULT 0,
  total_winnings numeric NOT NULL DEFAULT 0,
  UNIQUE(round_id, player_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_results ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Public read" ON players      FOR SELECT USING (true);
CREATE POLICY "Public read" ON rounds       FOR SELECT USING (true);
CREATE POLICY "Public read" ON round_players FOR SELECT USING (true);
CREATE POLICY "Public read" ON round_results FOR SELECT USING (true);

-- Public write (commish auth is client-side; fine for private friend-group app)
CREATE POLICY "Public write" ON players      FOR ALL USING (true);
CREATE POLICY "Public write" ON rounds       FOR ALL USING (true);
CREATE POLICY "Public write" ON round_players FOR ALL USING (true);
CREATE POLICY "Public write" ON round_results FOR ALL USING (true);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_round_players_round_id  ON round_players(round_id);
CREATE INDEX IF NOT EXISTS idx_round_players_player_id ON round_players(player_id);
CREATE INDEX IF NOT EXISTS idx_round_results_round_id  ON round_results(round_id);
CREATE INDEX IF NOT EXISTS idx_round_results_player_id ON round_results(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status           ON rounds(status);
CREATE INDEX IF NOT EXISTS idx_rounds_date             ON rounds(date DESC);

-- ============================================================
-- SEED DATA — 50 Players
-- ============================================================

INSERT INTO players (name, avg_score, rounds_played) VALUES
('Burton', 34.0, 1),
('Jon Murdock', 34.2, 10),
('Randy K.', 35.1, 24),
('Corey', 35.5, 4),
('Terry W.', 36.5, 8),
('Terrence (T$)', 36.8, 37),
('Larry', 37.5, 13),
('William W.', 37.7, 11),
('Jay Sheffield', 37.75, 8),
('Justin G', 37.89, 9),
('Dick', 38.1, 31),
('Nathan', 38.1, 49),
('Andy', 38.25, 8),
('Ben M.', 38.33, 3),
('Robin', 38.4, 40),
('Justin D', 38.43, 7),
('Billie W.', 38.5, 13),
('Lee', 38.8, 36),
('Rich P', 38.9, 29),
('Stuart', 38.9, 14),
('Matt W', 39.0, 5),
('Zac', 39.2, 41),
('Chris Lareau', 39.33, 3),
('Spencer T', 39.33, 3),
('Trey', 39.33, 3),
('Arthur', 39.4, 32),
('Benton', 39.5, 52),
('Bill S.', 39.6, 46),
('Harry O', 39.8, 28),
('Joe Jones', 40.1, 39),
('Webb Playford', 40.33, 9),
('David T.', 40.6, 5),
('Will Goodwin', 40.7, 47),
('Cary', 40.8, 25),
('Ricky', 40.86, 7),
('Ben H.', 41.0, 1),
('Robby', 41.1, 42),
('John G.', 41.33, 3),
('Brent P', 41.5, 2),
('JC Youngblood', 41.5, 2),
('Bryan H.', 41.6, 43),
('Joe Boone', 41.6, 5),
('Iain', 41.9, 25),
('Latty', 42.0, 5),
('John Markham', 42.1, 46),
('Hugh', 42.3, 14),
('Chip', 43.2, 12),
('Whitten S.', 43.33, 3),
('Colin', 44.0, 1),
('Sam G.', 44.0, 7)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- RSVPS
-- ============================================================

CREATE TABLE IF NOT EXISTS rsvps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id  uuid REFERENCES players(id) ON DELETE SET NULL,
  name       text NOT NULL,
  email      text NOT NULL,
  phone      text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(round_id, email)
);

ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read"  ON rsvps FOR SELECT USING (true);
CREATE POLICY "Public write" ON rsvps FOR ALL    USING (true);
CREATE INDEX IF NOT EXISTS idx_rsvps_round_id ON rsvps(round_id);
