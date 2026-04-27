-- 017_question_intensity.sql
-- Adds intensity preset + per-match question budget columns to leagues and venue_events.
-- These columns drive the intensity-based question system (CASUAL / STANDARD / HARDCORE).
-- Run in Supabase SQL Editor before deploying the updated generate-questions Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── leagues ──────────────────────────────────────────────────────────────────

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS question_intensity_preset TEXT
    NOT NULL DEFAULT 'standard'
    CHECK (question_intensity_preset IN ('casual','standard','hardcore')),

  ADD COLUMN IF NOT EXISTS prematch_question_budget INTEGER
    NOT NULL DEFAULT 4,   -- STANDARD preset: 4 prematch questions per match

  ADD COLUMN IF NOT EXISTS live_question_budget INTEGER
    NOT NULL DEFAULT 8;   -- STANDARD preset: 8 live questions per match

COMMENT ON COLUMN leagues.question_intensity_preset IS
  'Question intensity preset selected at league creation: casual | standard | hardcore. '
  'Determines target question count per match. Enforced by clampIntensity() on the client '
  'and validated against tier allowedPresets in the generation pipeline.';

COMMENT ON COLUMN leagues.prematch_question_budget IS
  'Target number of CORE_MATCH_PREMATCH questions to generate before match kick-off. '
  'Set from INTENSITY_PRESETS[preset].prematch at creation time. '
  'casual=3 / standard=4 / hardcore=6. Pool generation target = MAX across leagues sharing same profile.';

COMMENT ON COLUMN leagues.live_question_budget IS
  'Target number of CORE_MATCH_LIVE questions to generate during the match. '
  'Set from INTENSITY_PRESETS[preset].live at creation time. '
  'casual=5 / standard=8 / hardcore=12.';

-- ── venue_events ─────────────────────────────────────────────────────────────

ALTER TABLE venue_events
  ADD COLUMN IF NOT EXISTS question_intensity_preset TEXT
    NOT NULL DEFAULT 'standard'
    CHECK (question_intensity_preset IN ('casual','standard','hardcore')),

  ADD COLUMN IF NOT EXISTS prematch_question_budget INTEGER
    NOT NULL DEFAULT 4,

  ADD COLUMN IF NOT EXISTS live_question_budget INTEGER
    NOT NULL DEFAULT 8;

COMMENT ON COLUMN venue_events.question_intensity_preset IS
  'Intensity preset for this venue event. Venue Starter is gated to casual only (aiPreviewPerEvent: 3).';

COMMENT ON COLUMN venue_events.prematch_question_budget IS
  'Target prematch questions for this event. For Venue Starter, hard-capped to aiPreviewPerEvent (3) '
  'regardless of preset value — enforced by league_id count in generation pipeline.';

-- ── indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leagues_intensity_preset
  ON leagues (question_intensity_preset);
