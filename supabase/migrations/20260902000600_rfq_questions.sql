-- ============================================================================
-- 017  RFQ questions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Questions the brand wants every factory to answer
-- ---------------------------------------------------------------------------
-- Answers are public to the other invited factories by default. That matches
-- how RFQs work in the trade and saves the brand answering the same thing five
-- times. `is_sensitive` is the exception — a question whose answer stays
-- between that factory and the brand.
-- ---------------------------------------------------------------------------

create table public.rfq_questions (
  id           uuid primary key default gen_random_uuid(),
  rfq_id       uuid not null references public.rfqs (id) on delete cascade,
  prompt       text not null check (length(btrim(prompt)) > 0),
  is_sensitive boolean not null default false,
  sort         integer not null default 0,
  created_at   timestamptz not null default now()
);

create index rfq_questions_rfq_idx on public.rfq_questions (rfq_id, sort);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.rfq_questions   enable row level security;

-- Questions are visible to anyone who can see the RFQ. The answers are what
-- carry the sensitivity, and those are governed on quote_question_answers.
create policy rfq_questions_read on public.rfq_questions
  for select to authenticated
  using (public.can_see_rfq(rfq_id));

create policy rfq_questions_brand_write on public.rfq_questions
  for all to authenticated
  using (public.is_org_member(public.rfq_brand_org(rfq_id)))
  with check (public.is_org_member(public.rfq_brand_org(rfq_id)));

grant select, insert, update, delete on public.rfq_questions   to authenticated;
