-- Migration 031: Denormalized player_count on match_lobbies
-- Eliminates the need to fetch all match_lobby_players rows to compute queue counts.
-- A DB trigger keeps player_count accurate on every INSERT/DELETE in match_lobby_players.
-- Frontend only queries match_lobbies — scales to any number of players.

-- ── Add counter column ────────────────────────────────────────────────────────
ALTER TABLE match_lobbies
  ADD COLUMN IF NOT EXISTS player_count INTEGER NOT NULL DEFAULT 0;

-- ── Trigger function ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_lobby_player_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE match_lobbies
      SET player_count = player_count + 1
      WHERE id = NEW.lobby_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE match_lobbies
      SET player_count = GREATEST(0, player_count - 1)
      WHERE id = OLD.lobby_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- ── Attach trigger ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS lobby_player_count_trigger ON match_lobby_players;

CREATE TRIGGER lobby_player_count_trigger
  AFTER INSERT OR DELETE ON match_lobby_players
  FOR EACH ROW EXECUTE FUNCTION update_lobby_player_count();

-- ── Backfill existing rows ────────────────────────────────────────────────────
UPDATE match_lobbies ml
  SET player_count = (
    SELECT COUNT(*) FROM match_lobby_players mlp WHERE mlp.lobby_id = ml.id
  );
