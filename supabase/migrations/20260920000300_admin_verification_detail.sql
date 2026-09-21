-- ============================================================================
-- Evidence completeness, on the verification queue
-- ----------------------------------------------------------------------------
-- Supersedes the note in 20260912000100 that said confidence scores and a
-- per-check breakdown were deliberately not built. The reasoning there was
-- right: they were described as the output of an automated registry check that
-- does not exist, and an invented number on a reviewer's screen is trusted by
-- the person deciding whether a company may trade.
--
-- So the number is rebuilt from evidence that actually exists, and renamed on
-- screen to say what it measures.
--
-- WHAT IT MEANS
--   The share of the evidence TSC asks for that has arrived, weighted by how
--   much each piece matters, plus two internal-consistency signals.
--   100 means there is nothing left to chase.
--
-- WHAT IT CANNOT MEAN
--   It is not a probability that the company is real or solvent. Nothing here
--   contacts a company registry, a sanctions list, a certification body or the
--   live web, and nothing reads a file's contents beyond its size and type. A
--   forged registration that is present and legible scores exactly the same as
--   a genuine one. A well-prepared fraudster can reach 100. It is a triage
--   number -- who is ready to be looked at -- never a verdict.
--
-- Computed in SQL and only in SQL. The queue row and the detail card show the
-- same figure, and the capacity maths in this schema is the standing example
-- of what happens when the same arithmetic lives in two places. The adapter
-- reshapes; it does not calculate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Host of a URL, normalised for comparison.
-- ---------------------------------------------------------------------------
create or replace function public.url_host(value text)
returns text
language sql
immutable
as $$
  select nullif(
    split_part(
      split_part(
        regexp_replace(
          regexp_replace(lower(btrim(coalesce(value, ''))), '^[a-z][a-z0-9+.-]*://', ''),
          '^www\.', ''),
        '/', 1),
      ':', 1),
    '');
$$;

-- ---------------------------------------------------------------------------
-- Which profile fields this company was asked for, and which are filled.
--
-- One source for both the completeness percentage and the list of gaps, so
-- the sidebar figure and the check's detail line cannot disagree about what
-- is missing.
-- ---------------------------------------------------------------------------
create or replace function public.org_profile_fields(target_org uuid)
returns table (label text, present boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.label, f.present from (values
    ('legal name',   (select btrim(coalesce(p.legal_name, ''))  <> '' from public.factory_profiles p where p.org_id = target_org)),
    ('location',     (select btrim(coalesce(p.location, ''))    <> '' from public.factory_profiles p where p.org_id = target_org)),
    ('country',      (select p.country_code      is not null from public.factory_profiles p where p.org_id = target_org)),
    ('year founded', (select p.founded_year      is not null from public.factory_profiles p where p.org_id = target_org)),
    ('team size',    (select p.employee_count    is not null from public.factory_profiles p where p.org_id = target_org)),
    ('website',      (select btrim(coalesce(p.website_url, '')) <> '' from public.factory_profiles p where p.org_id = target_org)),
    ('introduction', (select btrim(coalesce(p.intro, ''))       <> '' from public.factory_profiles p where p.org_id = target_org)),
    ('MOQ',          (select p.moq               is not null from public.factory_profiles p where p.org_id = target_org)),
    ('lead time',    (select p.typical_lead_days is not null from public.factory_profiles p where p.org_id = target_org))
  ) as f(label, present)
  where f.present is not null

  union all

  select b.label, b.present from (values
    ('legal name',     (select btrim(coalesce(p.legal_name, ''))     <> '' from public.brand_profiles p where p.org_id = target_org)),
    ('headquarters',   (select btrim(coalesce(p.hq_location, ''))    <> '' from public.brand_profiles p where p.org_id = target_org)),
    ('year founded',   (select p.founded_year is not null from public.brand_profiles p where p.org_id = target_org)),
    ('website',        (select btrim(coalesce(p.website_url, ''))    <> '' from public.brand_profiles p where p.org_id = target_org)),
    ('introduction',   (select btrim(coalesce(p.intro, ''))          <> '' from public.brand_profiles p where p.org_id = target_org)),
    ('business email', (select btrim(coalesce(p.business_email, '')) <> '' from public.brand_profiles p where p.org_id = target_org)),
    ('business type',  (select p.brand_category  is not null from public.brand_profiles p where p.org_id = target_org)),
    ('order size',     (select p.order_size_band is not null from public.brand_profiles p where p.org_id = target_org))
  ) as b(label, present)
  where b.present is not null;
$$;

create or replace function public.org_profile_completion(target_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    round(100.0 * count(*) filter (where present) / nullif(count(*), 0))::integer,
    0)
  from public.org_profile_fields(target_org);
$$;

-- ---------------------------------------------------------------------------
-- The checks
-- ---------------------------------------------------------------------------
-- Each element is {label, result, value, detail, weight}, shaped for the
-- designed panel, which colours 'Verified' and 'Clear' as success, 'Missing'
-- and 'Rejected' as danger, and everything else as warning.
--
-- `value` is the share of that check's expected inputs that are present and
-- internally consistent -- not a probability. It is deterministic: the same
-- data gives the same number forever, which is the property the invented
-- score did not have.
--
-- `weight` rides along so the score below is a weighted mean of exactly the
-- rows the reviewer can see. A score with inputs that are not on screen is
-- the unexplainable number this replaces.
--
-- An uploaded-but-unreviewed registration scores 100, not 50. This answers
-- "is there something here to review", not "did we approve it" -- the review
-- state has its own home in org_reviews.state and in the status pill. Scoring
-- it lower would show a complete submission as "evidence missing".
-- ---------------------------------------------------------------------------
create or replace function public.org_verification_checks(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out_checks jsonb := '[]'::jsonb;
  org_kind   public.org_type;
  site_host  text;
  onboarded  boolean;
  reg        record;
  terms      record;
  domains    record;
  certs      record;
  comp       integer;
  gaps       text;
  dup_names  text;
  items      integer;
begin
  select o.type into org_kind from public.orgs o where o.id = target_org;
  if org_kind is null then
    return out_checks;
  end if;

  site_host := coalesce(
    public.url_host((select p.website_url from public.factory_profiles p where p.org_id = target_org)),
    public.url_host((select p.website_url from public.brand_profiles  p where p.org_id = target_org)));

  onboarded := coalesce(
    (select p.onboarding_completed_at is not null from public.factory_profiles p where p.org_id = target_org),
    (select p.onboarding_completed_at is not null from public.brand_profiles  p where p.org_id = target_org),
    false);

  -- 1. Business registration ------------------------------------------------
  select d.status, d.created_at, d.reviewed_at, coalesce(d.size_bytes, 0) as bytes,
         (select count(*) from public.documents x
           where x.org_id = target_org and x.kind = 'business_registration') as copies
    into reg
  from public.documents d
  where d.org_id = target_org and d.kind = 'business_registration'
  order by d.created_at desc
  limit 1;

  if reg is null then
    out_checks := out_checks || jsonb_build_object(
      'label', 'Business registration', 'result', 'Missing', 'value', 0, 'weight', 30,
      'detail', 'No business registration document has been uploaded.');
  elsif reg.status = 'rejected' then
    out_checks := out_checks || jsonb_build_object(
      'label', 'Business registration', 'result', 'Rejected', 'value', 0, 'weight', 30,
      'detail', case when reg.reviewed_at is null
                     then 'The most recent registration was rejected.'
                     else format('The most recent registration was rejected on %s.',
                                 to_char(reg.reviewed_at, 'DD Mon YYYY')) end);
  elsif reg.bytes = 0 then
    -- A zero-byte upload looks identical to a real one in every list.
    out_checks := out_checks || jsonb_build_object(
      'label', 'Business registration', 'result', 'Review', 'value', 0, 'weight', 30,
      'detail', 'The uploaded registration file is empty (0 bytes). Ask for it again.');
  else
    out_checks := out_checks || jsonb_build_object(
      'label', 'Business registration',
      'result', case when reg.status = 'verified' then 'Verified' else 'Review' end,
      'value', 100, 'weight', 30,
      'detail', format('Uploaded %s%s. %s Contents are not checked against any registry.',
        to_char(reg.created_at, 'DD Mon YYYY'),
        case when reg.copies > 1 then format(' (%s copies on file)', reg.copies) else '' end,
        case when reg.status <> 'verified' then 'Not yet reviewed.'
             when reg.reviewed_at is null then 'Marked verified.'
             else format('Marked verified on %s.', to_char(reg.reviewed_at, 'DD Mon YYYY')) end));
  end if;

  -- 2. Company details ------------------------------------------------------
  comp := public.org_profile_completion(target_org);
  select string_agg(label, ', ' order by label) into gaps
    from public.org_profile_fields(target_org) where not present;

  out_checks := out_checks || jsonb_build_object(
    'label', 'Company details',
    'result', case when comp = 100 then 'Clear' when comp >= 60 then 'Review' else 'Missing' end,
    'value', comp, 'weight', 20,
    'detail', case
      when gaps is null and onboarded then 'Every profile field asked for is filled in.'
      when gaps is null then 'Every profile field is filled in, but onboarding was never submitted.'
      else format('Not filled in: %s.%s', gaps,
                  case when onboarded then '' else ' Onboarding was never submitted.' end)
    end);

  -- 3. Terms accepted -------------------------------------------------------
  select a.signature, a.accepted_at, a.terms_version into terms
    from public.terms_acceptances a
   where a.org_id = target_org
   order by a.accepted_at desc
   limit 1;

  out_checks := out_checks || case
    when terms is null then jsonb_build_object(
      'label', 'Terms accepted', 'result', 'Missing', 'value', 0, 'weight', 10,
      'detail', 'No signed terms acceptance is recorded for this company.')
    else jsonb_build_object(
      'label', 'Terms accepted', 'result', 'Clear', 'value', 100, 'weight', 10,
      'detail', format('Signed "%s" on %s against terms version %s.',
                       terms.signature, to_char(terms.accepted_at, 'DD Mon YYYY'),
                       terms.terms_version))
  end;

  -- 4. Contact domain -------------------------------------------------------
  -- Shows the website and the accounts were set up together. It does NOT
  -- prove the domain belongs to this company -- anyone can buy a domain.
  select
    count(*) filter (where split_part(lower(u.email), '@', 2) = site_host) as matching,
    count(*) filter (where split_part(lower(u.email), '@', 2) = any (array[
      'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com',
      'yahoo.com','icloud.com','qq.com','163.com','126.com','foxmail.com'])) as freemail,
    count(*) as total
    into domains
  from public.org_members m
  join public.user_profiles u on u.id = m.user_id
  where m.org_id = target_org and u.email is not null;

  out_checks := out_checks || case
    when domains.total = 0 then jsonb_build_object(
      'label', 'Contact domain', 'result', 'Missing', 'value', 0, 'weight', 10,
      'detail', 'No member email address is on file, so a decision cannot be sent.')
    when site_host is null then jsonb_build_object(
      'label', 'Contact domain', 'result', 'Missing', 'value', 0, 'weight', 10,
      'detail', 'No website was given, so member addresses cannot be compared against one.')
    when domains.matching > 0 then jsonb_build_object(
      'label', 'Contact domain', 'result', 'Clear', 'value', 100, 'weight', 10,
      'detail', format('%s of %s member address(es) use %s. The two were set up together; this does not prove the domain is owned by this company.',
                       domains.matching, domains.total, site_host))
    when domains.freemail = domains.total then jsonb_build_object(
      'label', 'Contact domain', 'result', 'Review', 'value', 25, 'weight', 10,
      'detail', format('Every member address uses a public email provider, so nothing corroborates %s.', site_host))
    else jsonb_build_object(
      'label', 'Contact domain', 'result', 'Review', 'value', 50, 'weight', 10,
      'detail', format('No member address uses %s.', site_host))
  end;

  -- 5. Duplicate company signal ---------------------------------------------
  -- Demo orgs are excluded from the comparison set as well as from the queue:
  -- a demo clone of a real factory would otherwise flag the real one forever.
  select string_agg(distinct m.name, ', ') into dup_names
  from (
    select o.name
    from public.orgs o
    left join public.factory_profiles f on f.org_id = o.id
    left join public.brand_profiles   b on b.org_id = o.id
    where o.id <> target_org
      and o.is_demo = false
      and (
        (site_host is not null
         and site_host in (public.url_host(f.website_url), public.url_host(b.website_url)))
        or
        (nullif(regexp_replace(lower(coalesce(f.legal_name, b.legal_name, '')), '[^a-z0-9]', '', 'g'), '')
           = (select nullif(regexp_replace(lower(coalesce(pf.legal_name, pb.legal_name, '')), '[^a-z0-9]', '', 'g'), '')
                from public.orgs po
                left join public.factory_profiles pf on pf.org_id = po.id
                left join public.brand_profiles   pb on pb.org_id = po.id
               where po.id = target_org))
      )
  ) m;

  out_checks := out_checks || case
    when dup_names is null then jsonb_build_object(
      'label', 'Duplicate company signal', 'result', 'Clear', 'value', 100, 'weight', 5,
      'detail', 'No other company on the platform shares this legal name or website domain.')
    else jsonb_build_object(
      'label', 'Duplicate company signal', 'result', 'Review', 'value', 0, 'weight', 5,
      'detail', format('Shares a legal name or website domain with: %s.', dup_names))
  end;

  -- 6. Certification evidence -----------------------------------------------
  -- Factories only, and only when any are claimed: a company is not missing
  -- something it was never asked for, so the row is omitted rather than
  -- scored zero.
  if org_kind = 'factory' then
    select count(*) as claimed,
           count(*) filter (where c.document_id is not null and c.status <> 'rejected') as backed,
           count(*) filter (where c.status = 'verified') as verified,
           count(*) filter (where c.expires_at is not null and c.expires_at < current_date) as expired
      into certs
    from public.factory_certifications c
    where c.org_id = target_org;

    if certs.claimed > 0 then
      out_checks := out_checks || jsonb_build_object(
        'label', 'Certification evidence',
        'result', case when certs.verified = certs.claimed then 'Clear'
                       when certs.backed = 0 then 'Missing' else 'Review' end,
        'value', round(100.0 * certs.backed / certs.claimed)::integer,
        'weight', 15,
        'detail', format('%s claimed, %s with a document, %s already verified%s. Scope and issuer are not checked with the certifier.',
          certs.claimed, certs.backed, certs.verified,
          case when certs.expired > 0 then format(', %s past its expiry date', certs.expired) else '' end));
    end if;
  end if;

  -- 7. Production / brand evidence ------------------------------------------
  select (
    (select count(*) from public.documents d
      where d.org_id = target_org
        and d.kind = any (case when org_kind = 'factory'
                               then array['walkthrough','product_image']::public.document_kind[]
                               else array['brand_direction','product_image','logo']::public.document_kind[] end))
    + (select count(*) from public.profile_showcase_items s where s.org_id = target_org)
  )::integer into items;

  out_checks := out_checks || jsonb_build_object(
    'label', case when org_kind = 'factory' then 'Production evidence' else 'Brand evidence' end,
    'result', case when items >= 3 then 'Clear' when items > 0 then 'Review' else 'Missing' end,
    'value',  case when items >= 3 then 100  when items > 0 then 50    else 0 end,
    'weight', 10,
    'detail', format('%s image or walkthrough file(s) uploaded. Nobody has confirmed they show this company''s own facility or product.', items));

  return out_checks;
end;
$$;

create or replace function public.org_verification_score(target_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when sum((c ->> 'weight')::numeric) > 0
    then round(sum((c ->> 'weight')::numeric * (c ->> 'value')::numeric)
             / sum((c ->> 'weight')::numeric))::integer
  end
  from jsonb_array_elements(public.org_verification_checks(target_org)) c;
$$;

-- These are NOT granted to authenticated. They are security definer, so a
-- grant would let any signed-in user score any company on the platform and
-- read back its profile gaps. They are called only from inside the admin RPCs
-- below, which are themselves definer and guard on the first statement, so
-- the privilege check lives in exactly one place.
revoke all on function public.url_host(text)                from public;
revoke all on function public.org_profile_fields(uuid)      from public;
revoke all on function public.org_profile_completion(uuid)  from public;
revoke all on function public.org_verification_checks(uuid) from public;
revoke all on function public.org_verification_score(uuid)  from public;

-- ---------------------------------------------------------------------------
-- The queue, now carrying the checks
-- ---------------------------------------------------------------------------
-- The checks travel ON THE ROW rather than behind a second fetch. The designed
-- screen loads the queue once and hands VerificationDetail a member of that
-- array -- there is no detail fetch to hook into -- so putting them here means
-- the review screen lights up with no new data plumbing through Queena's file,
-- which is the file that has to keep merging cleanly. The queue is staff-sized.
--
-- Also new: vendor_kind. The design filters on three company types while
-- orgs.type has two; a trading company is a factory profile with
-- vendor_kind = 'trading_company'. The third tab was never dead, just
-- unreachable.
--
-- The return type changes, so this drops and recreates rather than replacing.
-- admin_overview_metrics() calls this from a plpgsql body, which Postgres does
-- not dependency-track, so there is no cascade to worry about -- but the
-- revoke/grant has to be reissued below.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_verification_queue();

create function public.admin_verification_queue()
returns table (
  org_id              uuid,
  org_name            text,
  org_type            public.org_type,
  org_slug            text,
  vendor_kind         public.vendor_kind,
  location            text,
  legal_name          text,
  website_url         text,
  intro               text,
  submitted_at        timestamptz,
  state               public.org_review_state,
  risk                public.org_review_risk,
  note                text,
  owner_user_id       uuid,
  owner_name          text,
  verification_status public.verification_status,
  evidence_received   integer,
  evidence_expected   integer,
  profile_completion  integer,
  verification_score  integer,
  verification_checks jsonb,
  capabilities        jsonb,
  decided_at          timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- First statement, before any select: checking afterwards leaks whether a
  -- row exists through the difference between P0002 and 42501.
  if not public.is_platform_admin() then
    raise exception 'this queue is limited to platform staff' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select
      o.id,
      o.name,
      o.type,
      o.slug,
      f.vendor_kind                    as vendor_kind,
      f.location                       as location,
      f.legal_name                     as legal_name,
      f.website_url                    as website_url,
      f.intro                          as intro,
      f.verification_status            as verification_status,
      coalesce(f.onboarding_completed_at, f.updated_at) as submitted_at
    from public.orgs o
    join public.factory_profiles f on f.org_id = o.id
    where o.is_demo = false
      and (
        f.onboarding_completed_at is not null
        or exists (
          select 1 from public.documents d
          where d.org_id = o.id
            and d.kind in ('business_registration', 'certificate')
        )
      )

    union all

    select
      o.id,
      o.name,
      o.type,
      o.slug,
      null::public.vendor_kind,
      b.hq_location,
      b.legal_name,
      b.website_url,
      b.intro,
      b.verification_status,
      coalesce(b.onboarding_completed_at, b.updated_at)
    from public.orgs o
    join public.brand_profiles b on b.org_id = o.id
    where o.is_demo = false
      and (
        b.onboarding_completed_at is not null
        or exists (
          select 1 from public.documents d
          where d.org_id = o.id
            and d.kind in ('business_registration', 'certificate')
        )
      )
  )
  select
    c.id,
    c.name,
    c.type,
    c.slug,
    c.vendor_kind,
    c.location,
    c.legal_name,
    c.website_url,
    c.intro,
    c.submitted_at,
    coalesce(r.state, 'ready_for_review'::public.org_review_state),
    r.risk,
    r.note,
    r.owner_user_id,
    u.full_name,
    c.verification_status,
    -- Capped. org_evidence_received() counts every registration document, so
    -- a company that uploaded its licence three times was rendering on the
    -- review screen as "3 of 1 received".
    least(public.org_evidence_received(c.id), public.org_evidence_expected(c.id)),
    public.org_evidence_expected(c.id),
    public.org_profile_completion(c.id),
    public.org_verification_score(c.id),
    public.org_verification_checks(c.id),
    -- What the company says it does, for the designed chip section. Labels,
    -- not slugs: this is the one place the vocabulary is displayed rather
    -- than matched on.
    coalesce((
      select jsonb_agg(t.label_en order by t.label_en)
        from public.taxonomy_links l
        join public.taxonomy_terms t on t.id = l.term_id
       where l.org_id = c.id
         and l.subject_type in ('brand_profile', 'factory_profile')
    ), '[]'::jsonb),
    r.decided_at
  from candidates c
  left join public.org_reviews r on r.org_id = c.id
  left join public.user_profiles u on u.id = r.owner_user_id
  order by
    -- Undecided first, oldest submission first inside that: a queue sorted by
    -- how long someone has been waiting, not by when we last touched it.
    case coalesce(r.state, 'ready_for_review'::public.org_review_state)
      when 'ready_for_review'  then 0
      when 'in_review'         then 1
      when 'needs_information' then 2
      else 3
    end,
    c.submitted_at asc;
end;
$$;

revoke all on function public.admin_verification_queue() from public;
grant execute on function public.admin_verification_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- One company's uploaded files
-- ---------------------------------------------------------------------------
-- A reviewer has to be able to open what was submitted. documents_own already
-- ends in `or is_platform_admin()` and so does the org-private storage read
-- policy, so the rows and the signed URLs both work through ordinary RLS --
-- this exists to scope the list to what the COMPANY submitted about itself.
-- Order, quote and message attachments belong to a deal, not to this review.
-- ---------------------------------------------------------------------------
create or replace function public.admin_org_documents(target_org uuid)
returns table (
  id           uuid,
  kind         public.document_kind,
  bucket       text,
  storage_path text,
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  status       public.verification_status,
  review_note  text,
  reviewed_at  timestamptz,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'these documents are limited to platform staff' using errcode = '42501';
  end if;

  return query
  select d.id, d.kind, d.bucket, d.storage_path, d.file_name, d.mime_type,
         d.size_bytes, d.status, d.review_note, d.reviewed_at, d.created_at
    from public.documents d
   where d.org_id = target_org
     and d.kind in ('business_registration', 'certificate', 'logo',
                    'product_image', 'walkthrough', 'brand_direction', 'other')
   order by d.created_at;
end;
$$;

revoke all on function public.admin_org_documents(uuid) from public;
grant execute on function public.admin_org_documents(uuid) to authenticated;
