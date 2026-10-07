-- ============================================================================
-- The factory's profile files: names, descriptions, and walkthrough videos
-- ----------------------------------------------------------------------------
-- The profile's designed file dialogs ask for an image's name and a short
-- description, and show both on the profile's sample cards. `documents` had
-- only the uploaded file's own name, so two nullable columns hold them:
--
--   title    what the card calls the file ("Organic poplin fit sample")
--   caption  the line under it ("Wovens · sample development")
--
-- Both are written by the owning company like the rest of its documents row
-- (`documents_own`), and read by whoever may already read the row; nothing
-- else changes. Older rows and older code simply have them null. They are
-- capped (120 and 240 characters) as card text, not documents.
--
-- The walkthrough is a video, and it is stored in the public bucket so brands
-- can watch it from the profile, but that bucket only ever admitted images,
-- so every walkthrough upload was refused. It now also admits MP4 and
-- QuickTime (what phones record), and its size limit rises from 10 MB to
-- 50 MB, the private bucket's, which is the hosted project's own upload cap.
-- ============================================================================

alter table public.documents
  add column if not exists title   text check (char_length(title) <= 120),
  add column if not exists caption text check (char_length(caption) <= 240);

update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct type)
           from unnest(allowed_mime_types || array['video/mp4', 'video/quicktime']) as type
       ),
       file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
 where id = 'org-public';
