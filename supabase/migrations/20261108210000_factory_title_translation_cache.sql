-- Server-only cache for Chinese RFQ / order title translations.
create table public.factory_title_translation_cache (
  source_hash text primary key,
  translation text not null,
  translated boolean not null,
  created_at timestamptz not null default now()
);
alter table public.factory_title_translation_cache enable row level security;
revoke all on public.factory_title_translation_cache from anon, authenticated;
grant all on public.factory_title_translation_cache to service_role;
