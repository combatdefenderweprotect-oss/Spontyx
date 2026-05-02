-- Migration 043: Battle Royale Session Players
--
-- Per-player state within a BR session. HP is the survival mechanic:
--   - Starts at 100
--   - Cap at 150 (cannot exceed, including streak bonuses)
--   - Floor at 0 (eliminated when HP reaches 0)
--   - Standard wrong answer / no answer = −15 HP (br_wrong_damage)
--   - Streak bonuses (Phase 1 schema, Phase 2 activation):
--       2 consecutive correct → +5 HP
--       3+ consecutive correct → +10 HP
--
-- is_eliminated: set when hp = 0. Eliminated players remain in the table
-- (for scoreboard history) but stop receiving questions.
--
-- placement: NULL while session is active; integer when session completes.
--   placement 1 = winner; higher number = eliminated earlier (worse).
--
-- Late join enforcement: a Postgres trigger rejects any INSERT into this
-- table when br_sessions.status != 'waiting'. No exception — joining a
-- session in progress is not allowed.


-- ── 1. BR_SESSION_PLAYERS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS br_session_players (
  -- Composite PK — one row per (session, user)
  session_id            UUID          NOT NULL
                          REFERENCES br_sessions (id) ON DELETE CASCADE,
  user_id               UUID          NOT NULL
                          REFERENCES auth.users (id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, user_id),
  -- Team assignment (NULL for FFA mode)
  team_number           INTEGER       CHECK (team_number IN (1, 2)),
  -- HP survival state
  hp                    INTEGER       NOT NULL DEFAULT 100
                          CHECK (hp BETWEEN 0 AND 150),
  is_eliminated         BOOLEAN       NOT NULL DEFAULT false,
  eliminated_at         TIMESTAMPTZ,
  -- Streak tracking (for HP bonus computation)
  current_streak        INTEGER       NOT NULL DEFAULT 0,
  -- Final placement (NULL while active; set by finalize_br_session)
  placement             INTEGER       CHECK (placement >= 1),
  -- Timestamps
  joined_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Active player lookup per session (used by advance_br_session_round)
CREATE INDEX IF NOT EXISTS idx_br_session_players_session
  ON br_session_players (session_id, is_eliminated);

-- Per-user game history lookup
CREATE INDEX IF NOT EXISTS idx_br_session_players_user
  ON br_session_players (user_id, joined_at DESC);


-- ── 2. Late-join enforcement trigger ──────────────────────────────────────────
-- Hard reject: no player may join a BR session that is no longer 'waiting'.
-- This is enforced at the DB level — not just the UI — to prevent race
-- conditions where two clients race to join simultaneously as the session
-- transitions to 'active'.

CREATE OR REPLACE FUNCTION enforce_br_late_join()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM br_sessions WHERE id = NEW.session_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'br_session_not_found: session % does not exist', NEW.session_id;
  END IF;

  IF v_status <> 'waiting' THEN
    RAISE EXCEPTION 'br_session_not_waiting: cannot join session % in status %',
      NEW.session_id, v_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_br_late_join ON br_session_players;
CREATE TRIGGER trg_br_late_join
  BEFORE INSERT ON br_session_players
  FOR EACH ROW EXECUTE FUNCTION enforce_br_late_join();


-- ── 3. RLS ────────────────────────────────────────────────────────────────────
-- Read: all authenticated users (spectator support; scoreboard visible to all).
-- Insert: authenticated users insert their own row only.
-- Delete: authenticated users remove their own row only (leave lobby).
-- Update: service role only (HP changes, elimination, placement — server-authoritative).

ALTER TABLE br_session_players ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_session_players' AND policyname = 'br_splay_select'
  ) THEN
    CREATE POLICY "br_splay_select"
      ON br_session_players FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_session_players' AND policyname = 'br_splay_insert'
  ) THEN
    CREATE POLICY "br_splay_insert"
      ON br_session_players FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_session_players' AND policyname = 'br_splay_delete'
  ) THEN
    CREATE POLICY "br_splay_delete"
      ON br_session_players FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;


-- ── 4. Realtime ───────────────────────────────────────────────────────────────
-- BR session pages subscribe to HP and elimination changes so the scoreboard
-- updates instantly when the resolver processes each round.
ALTER PUBLICATION supabase_realtime ADD TABLE br_session_players;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_session_players'
ORDER BY ordinal_position;
