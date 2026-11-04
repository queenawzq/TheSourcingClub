-- Server-only cache, keyed by exact source text so profile edits invalidate it.
create table public.profile_translation_cache (
  source_hash text primary key,
  english text not null,
  translated boolean not null,
  created_at timestamptz not null default now()
);
alter table public.profile_translation_cache enable row level security;
revoke all on public.profile_translation_cache from anon, authenticated;
grant all on public.profile_translation_cache to service_role;
