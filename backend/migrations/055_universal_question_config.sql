-- Migration 055: Universal question configuration for all league types
-- Adds four columns that support the shared Step 3 question setup UI
-- for Match Night, Season-Long, and Custom League.
--
-- question_style            — which generation lanes run (prematch / live / hybrid)
-- real_world_enabled        — explicit opt-in to REAL_WORLD generation
-- real_world_questions_per_week — user-chosen weekly REAL_WORLD intensity (1–3)
-- custom_questions_enabled  — reserved field for the upcoming custom-question feature
--
-- Backward compatibility:
--   - question_style NULL → treated as 'hybrid' by the generator (all lanes run)
--   - real_world_enabled defaults TRUE so new leagues created before the UI update
--     still receive REAL_WORLD generation; backfill also sets true for existing leagues
--     that had ai_questions_enabled = true
--   - real_world_questions_per_week NULL → generator defaults to 2 (Medium)
--   - custom_questions_enabled defaults false; generator does not act on it yet

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS question_style TEXT DEFAULT 'hybrid'
    CHECK (question_style IN ('prematch', 'live', 'hybrid')),

  ADD COLUMN IF NOT EXISTS real_world_enabled BOOLEAN NOT NULL DEFAULT true,

  ADD COLUMN IF NOT EXISTS real_world_questions_per_week INTEGER DEFAULT 2
    CHECK (
      real_world_questions_per_week IS NULL OR
      (real_world_questions_per_week >= 1 AND real_world_questions_per_week <= 3)
    ),

  ADD COLUMN IF NOT EXISTS custom_questions_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN leagues.question_style IS
  'Creator-chosen question lane. prematch = pre-match questions only; '
  'live = live in-game questions only; hybrid = both lanes. '
  'NULL is treated as ''hybrid'' by the generator for backward compatibility. '
  'Controls which of the three generation passes (prematch / live / REAL_WORLD) run.';

COMMENT ON COLUMN leagues.real_world_enabled IS
  'Controls REAL_WORLD question generation for this league. '
  'Defaults to true so leagues created before the UI update continue receiving REAL_WORLD questions. '
  'The UI will set this explicitly once Step 3 is updated; until then the default applies. '
  'REAL_WORLD generation is additionally blocked when question_style = ''live''.';

COMMENT ON COLUMN leagues.real_world_questions_per_week IS
  'User-chosen REAL_WORLD intensity: 1 = Low, 2 = Medium, 3 = High. '
  'Acts as a per-league weekly cap — the platform-level hard cap of 3/week still applies. '
  'NULL is treated as 2 (Medium) by the generator. '
  'Pro tier: the monthly pool cap of 10 per league still applies on top.';

COMMENT ON COLUMN leagues.custom_questions_enabled IS
  'Reserved for the upcoming custom / manual question feature. '
  'Stored at league creation but NOT acted on by the generator yet. '
  'Do not add generation logic until the custom question UI ships.';

-- ── Backfill ──────────────────────────────────────────────────────────────

-- All existing leagues default to hybrid (all lanes enabled).
UPDATE public.leagues
SET question_style = 'hybrid'
WHERE question_style IS NULL;

-- Enable REAL_WORLD for leagues that already had AI generation on,
-- so their generation behaviour is unchanged after this migration.
UPDATE public.leagues
SET real_world_enabled = true
WHERE ai_questions_enabled = true
  AND real_world_enabled = false;

-- Medium intensity (2/week) for all existing leagues.
UPDATE public.leagues
SET real_world_questions_per_week = 2
WHERE real_world_questions_per_week IS NULL;

-- custom_questions_enabled: default false — no backfill required.
