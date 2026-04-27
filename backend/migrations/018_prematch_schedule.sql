-- 018_prematch_schedule.sql
-- Adds pre-match question scheduling control to leagues.
--
-- Allows league owners to control WHEN prematch questions become visible.
--
-- Two modes:
--   automatic = generate within 48h of kickoff (current default — no change)
--   manual    = generate when now >= kickoff − N hours; visible_from = kickoff − N hours
--
-- Tier-gated:
--   Starter:  automatic only
--   Pro:      auto + manual [24h, 12h]
--   Elite:    auto + manual [48h, 24h, 12h, 6h]
--
-- Generation logic (Edge Function):
--   - Automatic: match eligible when kickoff is ≤ 48h away
--   - Manual:    match eligible when now ≥ kickoff − offset_hours
--   - Never generate after kickoff (both modes)
--   - visible_from: automatic = now; manual = kickoff − offset_hours (clamped to now if past)
--
-- Pool reuse stays intact — first league to trigger pool owns generation;
-- subsequent leagues receive the same canonical questions with per-league visible_from.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS prematch_generation_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (prematch_generation_mode IN ('automatic', 'manual')),
  ADD COLUMN IF NOT EXISTS prematch_publish_offset_hours INTEGER NOT NULL DEFAULT 24
    CHECK (prematch_publish_offset_hours IN (48, 24, 12, 6));

-- Index: useful for filtering active AI leagues by scheduling mode in the Edge Function
CREATE INDEX IF NOT EXISTS idx_leagues_prematch_mode
  ON leagues (prematch_generation_mode)
  WHERE ai_questions_enabled = true;

COMMENT ON COLUMN leagues.prematch_generation_mode IS
  'automatic = publish within 48h of kickoff (default); manual = publish exactly at kickoff − offset hours';
COMMENT ON COLUMN leagues.prematch_publish_offset_hours IS
  'Manual mode only. Hours before kickoff to publish pre-match questions. Allowed: 48/24/12/6. Tier-gated: Pro=24/12h, Elite=48/24/12/6h. Default 24.';
