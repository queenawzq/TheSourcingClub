-- Queue the designed onboarding confirmation exactly once, in the same
-- transaction that marks a brand or vendor profile complete. Delivery is
-- handled by api/send-onboarding-complete.js after the browser proves it owns
-- the organization; keeping the durable intent here makes refreshes and
-- double-clicks safe.
create table public.onboarding_submission_email_outbox (
  org_id             uuid not null references public.orgs (id) on delete cascade,
  recipient_user_id  uuid not null references public.user_profiles (id) on delete cascade,
  recipient_email    text not null check (position('@' in recipient_email) > 1),
  recipient_name     text,
  company_name       text not null,
  profile_kind       text not null check (profile_kind in ('brand', 'factory', 'trading-company')),
  submitted_at       timestamptz not null,
  status             text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts           integer not null default 0 check (attempts >= 0),
  provider_id        text,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  sent_at            timestamptz,
  primary key (org_id, recipient_user_id)
);

create trigger onboarding_submission_email_outbox_touch
  before update on public.onboarding_submission_email_outbox
  for each row execute function public.touch_updated_at();

alter table public.onboarding_submission_email_outbox enable row level security;
revoke all on public.onboarding_submission_email_outbox from anon, authenticated;
grant select, insert, update on public.onboarding_submission_email_outbox to service_role;

create or replace function public.queue_onboarding_submission_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  email_kind text;
begin
  if new.onboarding_completed_at is null
     or (tg_op = 'UPDATE' and old.onboarding_completed_at is not null) then
    return new;
  end if;

  if tg_table_name = 'brand_profiles' then
    email_kind := 'brand';
  elsif new.vendor_kind = 'trading_company' then
    email_kind := 'trading-company';
  else
    email_kind := 'factory';
  end if;

  insert into public.onboarding_submission_email_outbox (
    org_id, recipient_user_id, recipient_email, recipient_name,
    company_name, profile_kind, submitted_at
  )
  select
    new.org_id,
    member.user_id,
    profile.email,
    profile.full_name,
    coalesce(nullif(btrim(new.legal_name), ''), organization.name),
    email_kind,
    new.onboarding_completed_at
    from public.org_members member
    join public.user_profiles profile on profile.id = member.user_id
    join public.orgs organization on organization.id = member.org_id
   where member.org_id = new.org_id
     and member.role = 'owner'
     and coalesce(btrim(profile.email), '') <> ''
  on conflict (org_id, recipient_user_id) do nothing;

  return new;
end;
$$;

create trigger brand_profile_onboarding_submission_email
  after insert or update of onboarding_completed_at on public.brand_profiles
  for each row execute function public.queue_onboarding_submission_email();

create trigger factory_profile_onboarding_submission_email
  after insert or update of onboarding_completed_at on public.factory_profiles
  for each row execute function public.queue_onboarding_submission_email();
