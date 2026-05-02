-- Migration 049: BR Question Type + Pool Insert Policy
--
-- Two targeted changes to unblock the BR frontend:
--
-- 1. Add BR_MATCH_LIVE to questions.question_type CHECK constraint.
--    The resolver and RPCs reference this type; it must be insertable.
--
-- 2. Add authenticated INSERT RLS policy to br_match_pools.
--    The BR lobby creates a placeholder pool (status='ready', question_count=0)
--    before instantiating a session. Without this policy, only service_role can
--    insert into br_match_pools, blocking lobby creation from the browser.
--
-- Also adds authenticated INSERT to br_match_pool_questions so future tooling
-- can seed pool questions from the browser (admin flows, test seeding).


-- ── 1. Expand questions.question_type CHECK constraint ────────────────────────

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_question_type_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_question_type_check CHECK (
    question_type IN (
      'CORE_MATCH_PREMATCH',
      'CORE_MATCH_LIVE',
      'REAL_WORLD',
      'BR_MATCH_LIVE'
    )
  );


-- ── 2. Allow authenticated users to INSERT into br_match_pools ────────────────
-- Needed so the BR lobby can create placeholder pools from the browser.
-- Pool uniqueness is enforced by the partial unique index on (match_id, half_scope)
-- where status NOT IN ('failed','stale').

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_match_pools' AND policyname = 'br_pools_insert'
  ) THEN
    CREATE POLICY "br_pools_insert"
      ON br_match_pools
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;


-- ── 3. Allow authenticated users to INSERT into br_match_pool_questions ────────
-- Needed for future admin/seeding flows and test tooling.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'br_match_pool_questions' AND policyname = 'br_pool_questions_insert'
  ) THEN
    CREATE POLICY "br_pool_questions_insert"
      ON br_match_pool_questions
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'questions'::regclass
  AND contype = 'c'
  AND conname = 'questions_question_type_check';

SELECT policyname, cmd
FROM pg_policies
WHERE tablename IN ('br_match_pools', 'br_match_pool_questions')
  AND policyname IN ('br_pools_insert', 'br_pool_questions_insert')
ORDER BY tablename, policyname;
