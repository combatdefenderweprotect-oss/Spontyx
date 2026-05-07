-- Migration 071: br_session_players — missing v2 columns
--
-- Adds columns required by the revised BR v2 gameplay model:
--
--   hp_at_elimination      — HP snapshot at the moment of elimination (always 0 in v1
--                            since floor is 0; reserved for future negative-HP risk
--                            mechanics). Stored for tiebreaking within same-round eliminations.
--
--   eliminated_at_seq      — Question sequence number at which the player was eliminated.
--                            Used by finalize_br_session() to rank eliminated players
--                            (later elimination = better placement).
--
--   avg_response_ms        — Average answer latency in ms across all questions the player
--                            answered. Written at finalize time from player_answers timestamps.
--                            Used as placement tiebreaker #4 (lower = better).
--                            NULL if no answers submitted or not yet computed.
--
--   correct_answer_count   — Running count of correct answers. Incremented by
--                            advance_br_session_round() on each correct answer.
--                            Used as placement tiebreaker #3 (higher = better).
--                            Avoids a COUNT query inside finalize_br_session().
--
-- br_rating_before/after/delta already added by migration 046. This migration
-- uses ADD COLUMN IF NOT EXISTS for safety on all columns.


ALTER TABLE br_session_players
  ADD COLUMN IF NOT EXISTS hp_at_elimination     INTEGER,
  ADD COLUMN IF NOT EXISTS eliminated_at_seq     INTEGER,
  ADD COLUMN IF NOT EXISTS avg_response_ms       INTEGER,
  ADD COLUMN IF NOT EXISTS correct_answer_count  INTEGER NOT NULL DEFAULT 0;


-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'br_session_players'
ORDER BY ordinal_position;
