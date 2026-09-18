-- ============================================================================
-- 040  Make the membership → profile relationship real
-- ----------------------------------------------------------------------------
-- listMembers() has been in src/lib/domain/org.js since Phase 1 and had never
-- been called by anything. The first screen to call it failed immediately:
--
--   Could not find a relationship between 'org_members' and 'user_profiles'
--
-- Both tables reference auth.users(id) — org_members.user_id and
-- user_profiles.id — so the connection is obvious to a person reading the
-- schema and invisible to PostgREST, which only follows declared foreign keys.
-- "Who is in this org, and what are their names" is the most natural question
-- to ask of a membership table, and it was unanswerable in one query.
--
-- user_profiles.id is the primary key and is populated by handle_new_user() on
-- the same auth.users insert that any membership must come after, so this
-- constraint cannot be violated by an ordinary sign-up.
-- ============================================================================

alter table public.org_members
  add constraint org_members_user_profile_fkey
  foreign key (user_id) references public.user_profiles (id) on delete cascade;
