-- Migration 074: drop stale instantiate_br_session v1 overload
--
-- Migration 072 replaced instantiate_br_session(uuid, bigint, integer) with a
-- pool-free version instantiate_br_session(uuid). The old 3-arg overload was not
-- explicitly dropped and both signatures coexist in pg_proc.
--
-- The resolver always calls the 1-arg version so runtime is unaffected, but the
-- old overload is dead code and must be removed to prevent future ambiguity.

DROP FUNCTION IF EXISTS instantiate_br_session(uuid, bigint, integer);

-- Verify only the new signature remains
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'instantiate_br_session';
