-- Migration 024: REAL_WORLD question fields
-- Adds columns required for news-driven REAL_WORLD questions:
-- resolution_condition, resolution_deadline, source_news_urls,
-- entity_focus, confidence_level, rw_context

-- Resolution condition: human-readable description of what makes this correct
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS resolution_condition TEXT;

-- Resolution deadline: when the question must be resolved by (auto-void if not)
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS resolution_deadline TIMESTAMPTZ;

-- Source news URLs: array of news article URLs that triggered the question
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS source_news_urls JSONB DEFAULT '[]'::jsonb;

-- Entity focus: what kind of entity the question is about
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS entity_focus TEXT CHECK (
    entity_focus IS NULL OR entity_focus IN ('player', 'coach', 'team', 'club')
  );

-- Confidence level: how strong the news signal was
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS confidence_level TEXT CHECK (
    confidence_level IS NULL OR confidence_level IN ('low', 'medium', 'high')
  );

-- Real World context: the generated "why this question exists" snippet (shown to users)
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS rw_context TEXT;

-- Index for deadline auto-void queries
CREATE INDEX IF NOT EXISTS idx_questions_resolution_deadline
  ON questions (resolution_deadline)
  WHERE resolution_status = 'pending' AND resolution_deadline IS NOT NULL;
