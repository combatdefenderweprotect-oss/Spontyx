-- =============================================================================
-- Migration 081: Trivia AI Credit System
-- =============================================================================
-- Creates three tables:
--   1. trivia_ai_credit_wallets       — per-user balance ledger
--   2. trivia_ai_credit_transactions  — immutable audit trail (debit/credit events)
--   3. trivia_ai_generation_logs      — per-generation-job record
--
-- Also wires the deferred FK on trivia_questions.generation_log_id.
--
-- All writes to wallets and transactions go through SECURITY DEFINER RPCs only.
-- Edge Functions (service role) write directly to generation_logs.
-- RLS: users read their own rows; no direct-write policies on any table.
-- Prerequisite: set_updated_at() trigger function (migration 076).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. trivia_ai_credit_wallets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trivia_ai_credit_wallets (
    user_id                     UUID        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    credits_balance             INT         NOT NULL DEFAULT 0
                                            CHECK (credits_balance >= 0),
    credits_used_lifetime       INT         NOT NULL DEFAULT 0
                                            CHECK (credits_used_lifetime >= 0),
    credits_purchased_lifetime  INT         NOT NULL DEFAULT 0
                                            CHECK (credits_purchased_lifetime >= 0),
    credits_granted_lifetime    INT         NOT NULL DEFAULT 0
                                            CHECK (credits_granted_lifetime >= 0),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at trigger
CREATE TRIGGER trg_trivia_ai_credit_wallets_updated_at
    BEFORE UPDATE ON trivia_ai_credit_wallets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE trivia_ai_credit_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tacw_select_own" ON trivia_ai_credit_wallets;
CREATE POLICY "tacw_select_own"
    ON trivia_ai_credit_wallets
    FOR SELECT
    USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies — all writes via SECURITY DEFINER RPCs.


-- ---------------------------------------------------------------------------
-- 2. trivia_ai_credit_transactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trivia_ai_credit_transactions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    amount            INT         NOT NULL,
    transaction_type  TEXT        NOT NULL
                                  CHECK (transaction_type IN ('purchase','spend','refund','grant','expiry')),
    description       TEXT,
    -- reference_id: generation_log_id for 'spend', Stripe payment_intent for 'purchase', etc.
    reference_id      UUID,
    balance_after     INT         NOT NULL
                                  CHECK (balance_after >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tacr_user
    ON trivia_ai_credit_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tacr_type
    ON trivia_ai_credit_transactions (transaction_type, created_at DESC);

-- RLS
ALTER TABLE trivia_ai_credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tacr_select_own" ON trivia_ai_credit_transactions;
CREATE POLICY "tacr_select_own"
    ON trivia_ai_credit_transactions
    FOR SELECT
    USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies — all writes via SECURITY DEFINER RPCs.


-- ---------------------------------------------------------------------------
-- 3. trivia_ai_generation_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trivia_ai_generation_logs (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    sport                    TEXT        NOT NULL
                                         CHECK (sport IN (
                                             'soccer','nfl','nba','mlb',
                                             'college_football','f1','tennis','mma'
                                         )),
    topic                    TEXT,
    difficulty               TEXT        NOT NULL DEFAULT 'medium'
                                         CHECK (difficulty IN ('easy','medium','hard','mixed')),
    question_count_requested INT         NOT NULL CHECK (question_count_requested > 0),
    question_count_generated INT         NOT NULL DEFAULT 0
                                         CHECK (question_count_generated >= 0),
    credits_spent            INT         NOT NULL DEFAULT 0
                                         CHECK (credits_spent >= 0),
    status                   TEXT        NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending','completed','partial','failed','refunded')),
    generated_question_ids   UUID[],
    set_id                   UUID        REFERENCES trivia_question_sets ON DELETE SET NULL,
    error_message            TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tagl_user
    ON trivia_ai_generation_logs (user_id, created_at DESC);

-- Partial index: only rows still in-flight (pending / partial) — keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_tagl_status
    ON trivia_ai_generation_logs (status)
    WHERE status IN ('pending', 'partial');

-- RLS
ALTER TABLE trivia_ai_generation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tagl_select_own" ON trivia_ai_generation_logs;
CREATE POLICY "tagl_select_own"
    ON trivia_ai_generation_logs
    FOR SELECT
    USING (auth.uid() = user_id);

-- No direct-write policies — Edge Function uses service role key.


-- ---------------------------------------------------------------------------
-- 4. Wire deferred FK: trivia_questions.generation_log_id
-- ---------------------------------------------------------------------------

ALTER TABLE trivia_questions
    ADD CONSTRAINT fk_tq_generation_log
    FOREIGN KEY (generation_log_id)
    REFERENCES trivia_ai_generation_logs (id)
    ON DELETE SET NULL;
