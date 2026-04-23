-- ════════════════════════════════════════════════════════════════════════
-- SPONTIX — Migration 011: Username / handle cleanup
-- ════════════════════════════════════════════════════════════════════════
-- Run in Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / DO NOTHING).
-- ════════════════════════════════════════════════════════════════════════

-- 1. Strip leading @ from all existing handles
UPDATE public.users
SET handle = substring(handle FROM 2)
WHERE handle IS NOT NULL AND handle LIKE '@%';

-- 2. NULL-out any handle that is now empty
UPDATE public.users
SET handle = NULL
WHERE handle = '';

-- 3. Case-insensitive unique index
--    The column already has a case-sensitive UNIQUE constraint from migration 001.
--    This adds a second, expression-based index so two users can't register
--    'richutis' and 'Richutis' — even though our validation forces lowercase,
--    this makes the guarantee structural.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_ci
  ON public.users (lower(handle))
  WHERE handle IS NOT NULL;

-- 4. Update the trigger so it reads the new metadata fields
--    Players: metadata.username → handle, metadata.first_name + last_name → name
--    Venues:  no username in metadata → handle stays NULL
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text;
  v_handle text;
BEGIN
  -- Full name: prefer first_name + last_name, then 'name', then email prefix
  v_name := NULLIF(TRIM(
    COALESCE(
      CASE
        WHEN (new.raw_user_meta_data->>'first_name') IS NOT NULL
          THEN TRIM(
            COALESCE(new.raw_user_meta_data->>'first_name', '') || ' ' ||
            COALESCE(new.raw_user_meta_data->>'last_name', '')
          )
        ELSE NULL
      END,
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  ), '');

  -- Handle: only set when 'username' was explicitly passed (players only)
  v_handle := NULLIF(TRIM(COALESCE(new.raw_user_meta_data->>'username', '')), '');

  INSERT INTO public.users (id, email, name, handle)
  VALUES (new.id, new.email, v_name, v_handle)
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;
