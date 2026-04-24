-- ══════════════════════════════════════════════════════════════════════
-- Migration 014: user-photos Storage bucket
-- Creates a public Supabase Storage bucket for player profile photos.
-- After this migration, uploadPlayerPhoto() stores CDN URLs instead of
-- base64 data URLs — fixing the localStorage quota issue and sidebar flash.
--
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hdulhffpmuqepoqstsor/sql/new
-- ══════════════════════════════════════════════════════════════════════

-- Create the bucket (public = files are readable without a signed URL)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-photos',
  'user-photos',
  true,
  5242880,  -- 5 MB limit per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies ──
-- Files are organised as {user_id}/profile.jpg
-- The first path segment is always the owner's user ID.

-- Public read: anyone can view profile photos (they're avatars)
CREATE POLICY "user_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'user-photos');

-- Authenticated users can upload/replace only their own folder
CREATE POLICY "user_photos_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'user-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "user_photos_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'user-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "user_photos_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'user-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
