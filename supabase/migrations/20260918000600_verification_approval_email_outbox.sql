-- Approval emails are queued in the same transaction as the review decision.
-- Delivery happens server-side through api/send-verification-approved.js, so a
-- browser refresh cannot lose the intent to notify and repeated clicks cannot
-- send the same person the same approval twice.
create table public.verification_approval_email_outbox (
  org_id             uuid not null references public.orgs (id) on delete cascade,
  recipient_user_id  uuid not null references public.user_profiles (id) on delete cascade,
  recipient_email    text not null check (position('@' in recipient_email) > 1),
  recipient_name     text,
  locale             text not null default 'en' check (locale in ('en', 'zh')),
  status             text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts           integer not null default 0 check (attempts >= 0),
  provider_id        text,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  sent_at            timestamptz,
  primary key (org_id, recipient_user_id)
);

create trigger verification_approval_email_outbox_touch
  before update on public.verification_approval_email_outbox
  for each row execute function public.touch_updated_at();

alter table public.verification_approval_email_outbox enable row level security;

-- No browser role receives table access. The Vercel function uses the service
-- role after separately proving that its caller is a platform admin.
grant select, insert, update on public.verification_approval_email_outbox to service_role;

create or replace function public.queue_verification_approval_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state = 'approved'
     and (tg_op = 'INSERT' or old.state is distinct from 'approved') then
    insert into public.verification_approval_email_outbox (
      org_id, recipient_user_id, recipient_email, recipient_name, locale
    )
    select
      new.org_id, member.user_id, profile.email, profile.full_name, profile.locale
      from public.org_members member
      join public.user_profiles profile on profile.id = member.user_id
     where member.org_id = new.org_id
       and member.role = 'owner'
       and coalesce(btrim(profile.email), '') <> ''
    on conflict (org_id, recipient_user_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger org_review_queue_approval_email
  after insert or update of state on public.org_reviews
  for each row execute function public.queue_verification_approval_email();
