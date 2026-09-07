-- ============================================================================
-- 018  Quotes
-- ----------------------------------------------------------------------------
-- Versioned: a revision writes a new row that supersedes the previous one, so
-- a price that moved after a conversation leaves a trace. "They quoted $18
-- last week" has to be answerable.
--
-- Deposit split, incoterm and capacity window are first-class columns here.
-- In the prototype they exist ONLY as `if (factory.name === "Ningbo Woven Co")`
-- branches inside getQuoteComparisonDetails() — real commercial terms faked as
-- control flow, with only two of three factories even distinguished.
-- ============================================================================

create type public.quote_status as enum (
  'draft',       -- factory is still writing it; the brand cannot see it
  'submitted',   -- live, visible to the brand
  'superseded',  -- replaced by a newer version
  'withdrawn',   -- pulled by the factory
  'accepted',    -- won
  'declined'     -- lost, or the brand awarded elsewhere
);

create table public.quotes (
  id             uuid primary key default gen_random_uuid(),
  rfq_id         uuid not null references public.rfqs (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,

  version             integer not null default 1 check (version > 0),
  supersedes_quote_id uuid references public.quotes (id),
  status              public.quote_status not null default 'draft',

  -- Nullable throughout: a draft is incomplete by definition. Constraints here
  -- validate SHAPE only. Completeness is validated in submit_quote(), which can
  -- name the specific missing field instead of raising one generic error.
  unit_price_cents    integer check (unit_price_cents is null or unit_price_cents >= 0),
  currency            char(3) not null default 'USD' check (currency = 'USD'),
  production_quantity integer check (production_quantity is null or production_quantity > 0),
  bulk_lead_time_days integer check (bulk_lead_time_days is null or bulk_lead_time_days >= 0),

  capacity_window_start date,
  capacity_window_end   date,
  capacity_window_units integer check (capacity_window_units is null or capacity_window_units >= 0),

  payment_term_id uuid references public.taxonomy_terms (id),
  deposit_pct     numeric(5,2) check (deposit_pct is null or (deposit_pct >= 0 and deposit_pct <= 100)),
  balance_pct     numeric(5,2) check (balance_pct is null or (balance_pct >= 0 and balance_pct <= 100)),

  incoterm_id    uuid references public.taxonomy_terms (id),
  shipping_notes text,

  valid_until   date,
  factory_notes text,

  created_by   uuid references auth.users (id) on delete set null,
  submitted_at timestamptz,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint quote_capacity_window_ordered check (
    capacity_window_start is null
    or capacity_window_end is null
    or capacity_window_start <= capacity_window_end
  ),
  constraint quote_deposit_balance_sum check (
    deposit_pct is null or balance_pct is null or deposit_pct + balance_pct = 100
  )
);

-- These two partial indexes are the whole mechanism that makes versioning
-- safe. A plain unique(rfq_id, factory_org_id) would forbid revision
-- entirely; without them, two live submissions for one factory on one RFQ can
-- coexist and "the latest quote" stops having an answer.
create unique index quotes_one_draft_per_factory
  on public.quotes (rfq_id, factory_org_id) where status = 'draft';

create unique index quotes_one_submitted_per_factory
  on public.quotes (rfq_id, factory_org_id) where status = 'submitted';

create index quotes_rfq_idx     on public.quotes (rfq_id, status);
create index quotes_factory_idx on public.quotes (factory_org_id, status);

create trigger quotes_touch
  before update on public.quotes
  for each row execute function public.touch_updated_at();

-- Deferred from migration 016: the two tables reference each other.
alter table public.rfqs
  add column if not exists awarded_quote_id uuid references public.quotes (id);

alter table public.documents
  add column if not exists quote_id uuid references public.quotes (id) on delete set null;

create index if not exists documents_quote_idx on public.documents (quote_id) where quote_id is not null;

-- ---------------------------------------------------------------------------
-- Sample plan
-- ---------------------------------------------------------------------------
-- The prototype hardcodes a sample subtotal per factory name (220 or 260)
-- while displaying the very lines that should produce it. Here the lines are
-- the truth and the subtotal is a function — nothing to keep in sync, and no
-- way for the total to disagree with its parts.
-- ---------------------------------------------------------------------------

create table public.quote_sample_lines (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  stage       text not null check (length(btrim(stage)) > 0),
  cost_cents  integer not null check (cost_cents >= 0),
  currency    char(3) not null default 'USD' check (currency = 'USD'),
  timing_days integer check (timing_days is null or timing_days >= 0),
  includes    text,
  sort        integer not null default 0
);

create index quote_sample_lines_quote_idx on public.quote_sample_lines (quote_id, sort);

-- Quote's parent RFQ, read without re-entering the quotes policy.
create or replace function public.quote_rfq(target_quote uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rfq_id from public.quotes where id = target_quote;
$$;

-- Quote status, likewise. The answers policy needs to know whether a quote is
-- live WITHOUT being able to read the quote itself — that is the whole point
-- of a competitor being able to see a public answer but not its author.
create or replace function public.quote_status_of(target_quote uuid)
returns public.quote_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select status from public.quotes where id = target_quote;
$$;

revoke all on function public.quote_status_of(uuid) from public;
grant execute on function public.quote_status_of(uuid) to authenticated;

revoke all on function public.quote_rfq(uuid) from public;
grant execute on function public.quote_rfq(uuid) to authenticated;

create or replace function public.quote_sample_subtotal(target_quote uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(cost_cents), 0)::integer
  from public.quote_sample_lines
  where quote_id = target_quote;
$$;

grant execute on function public.quote_sample_subtotal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Answers to the brand's questions
-- ---------------------------------------------------------------------------
-- Per question, not one combined blob. The factory prototype answers all three
-- questions in a single textarea, but it also carries an unused
-- QuoteAnswer({question, answer}) component — per-question was the intent, and
-- the public-answers decision requires it.
-- ---------------------------------------------------------------------------

create table public.quote_question_answers (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  question_id uuid not null references public.rfq_questions (id) on delete cascade,
  answer_text text,
  created_at  timestamptz not null default now(),
  unique (quote_id, question_id)
);

create index quote_question_answers_question_idx on public.quote_question_answers (question_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.quotes                enable row level security;
alter table public.quote_sample_lines    enable row level security;
alter table public.quote_question_answers enable row level security;

-- A factory sees every version of its own quotes. The brand sees anything on
-- its own RFQ except a draft. NOTHING here ever lets one factory read another
-- factory's quote — there is deliberately no branch for that.
create policy quotes_read on public.quotes
  for select to authenticated
  using (
    factory_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
    or (status <> 'draft' and public.is_org_member(public.rfq_brand_org(rfq_id)))
  );

-- The verification gate lives HERE, not in a disabled button. An unverified
-- factory could otherwise POST straight at the table.
create policy quotes_factory_insert on public.quotes
  for insert to authenticated
  with check (
    public.is_org_member(factory_org_id)
    and exists (
      select 1 from public.factory_profiles f
      where f.org_id = quotes.factory_org_id
        and f.verification_status = 'verified'
    )
    and public.rfq_status_of(rfq_id) = 'open'
    and public.can_see_rfq(rfq_id)
  );

-- Only drafts are directly editable. Every status transition goes through an
-- RPC, so a factory cannot mark its own quote accepted.
create policy quotes_factory_update on public.quotes
  for update to authenticated
  using (public.is_org_member(factory_org_id) and status = 'draft')
  with check (public.is_org_member(factory_org_id) and status = 'draft');

create policy sample_lines_read on public.quote_sample_lines
  for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_sample_lines.quote_id));

create policy sample_lines_write on public.quote_sample_lines
  for all to authenticated
  using (exists (
    select 1 from public.quotes q
    where q.id = quote_sample_lines.quote_id
      and public.is_org_member(q.factory_org_id)
      and q.status = 'draft'
  ))
  with check (exists (
    select 1 from public.quotes q
    where q.id = quote_sample_lines.quote_id
      and public.is_org_member(q.factory_org_id)
      and q.status = 'draft'
  ));

-- The most delicate policy in the schema. A competing factory may read an
-- answer only when the question is not sensitive AND the answering quote is
-- live. Note the anonymity guarantee is emergent: a competitor cannot join
-- this row back to a factory only because quotes_read gives them nothing.
-- Those two policies must never be changed independently.
create policy quote_answers_read on public.quote_question_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
      where q.id = quote_question_answers.quote_id
        and q.factory_org_id in (select public.current_org_ids())
    )
    or public.is_platform_admin()
    or public.is_org_member(public.rfq_brand_org(public.quote_rfq(quote_id)))
    or (
      public.quote_status_of(quote_id) in ('submitted', 'accepted', 'declined')
      and exists (
        select 1 from public.rfq_questions qq
        where qq.id = quote_question_answers.question_id and qq.is_sensitive = false
      )
      and public.can_see_rfq(public.quote_rfq(quote_id))
    )
  );

create policy quote_answers_write on public.quote_question_answers
  for all to authenticated
  using (exists (
    select 1 from public.quotes q
    where q.id = quote_question_answers.quote_id
      and public.is_org_member(q.factory_org_id)
      and q.status = 'draft'
  ))
  with check (exists (
    select 1 from public.quotes q
    where q.id = quote_question_answers.quote_id
      and public.is_org_member(q.factory_org_id)
      and q.status = 'draft'
  ));

grant select, insert, update         on public.quotes                 to authenticated;
grant select, insert, update, delete on public.quote_sample_lines     to authenticated;
grant select, insert, update, delete on public.quote_question_answers to authenticated;
