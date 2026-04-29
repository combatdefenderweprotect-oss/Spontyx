-- Migration 028: Enable Supabase Realtime for questions + player_answers
-- These tables need to be added to the supabase_realtime publication so that
-- the league.html Realtime subscription receives INSERT/UPDATE/DELETE events.
--
-- Safe to re-run — ADD TABLE IF NOT EXISTS is idempotent in Postgres 15+.
-- Run in Supabase SQL editor.

ALTER PUBLICATION supabase_realtime ADD TABLE questions;
ALTER PUBLICATION supabase_realtime ADD TABLE player_answers;
