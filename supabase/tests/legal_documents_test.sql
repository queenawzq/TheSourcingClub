-- ============================================================================
-- Legal documents — who may read, nobody may write, and what a signature says
-- ----------------------------------------------------------------------------
-- Sixth suite, `pgtap6-` prefixed, every assertion scoped to its own fixtures.
--
-- current_legal_documents() is the one function granted to anon, which makes
-- the negatives here the point: the table stays unreadable to everyone but
-- staff, and nobody through the API can add, rewrite or delete a version a
-- company may already have signed. New wording arrives by migration.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email) values
  ('c6000000-0000-0000-0000-000000000001', 'p6-admin@example.com'),
  ('c6000000-0000-0000-0000-000000000002', 'p6-brand@example.com');

insert into public.platform_admins (user_id, note)
values ('c6000000-0000-0000-0000-000000000001', 'pgtap6 fixture');

insert into public.orgs (id, type, name, slug) values
  ('d6000000-0000-0000-0000-00000000000b', 'brand', 'P6 Brand', 'pgtap6-brand');

insert into public.org_members (org_id, user_id, role) values
  ('d6000000-0000-0000-0000-00000000000b', 'c6000000-0000-0000-0000-000000000002', 'owner');

-- ---------------------------------------------------------------------------
-- Signed out: the current text, and nothing else
-- ---------------------------------------------------------------------------

set local role anon;

select is(
  (select count(distinct kind)::int from public.current_legal_documents()),
  4,
  'a signed-out visitor can read the current version of every document'
);

select is(
  (select count(*)::int from public.current_legal_documents()),
  4,
  'one current version per document, not the history'
);

select throws_ok(
  $$select count(*) from public.legal_documents$$, '42501',
  null, 'but not the table behind it'
);

-- ---------------------------------------------------------------------------
-- A signed-in company
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c6000000-0000-0000-0000-000000000002","email":"p6-brand@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.legal_documents),
  0,
  'a company cannot read the version history'
);

select throws_ok(
  $$insert into public.legal_documents (kind, version, onboarding_en, full_en)
    values ('terms_brand', 999, 'Heading
Body', 'Title
Sub')$$, '42501',
  null, 'nor publish terms of its own'
);

select throws_ok(
  $$update public.legal_documents set full_en = 'rewritten'$$, '42501',
  null, 'nor rewrite a published version'
);

select throws_ok(
  $$delete from public.legal_documents$$, '42501',
  null, 'nor delete one'
);

select lives_ok(
  $$insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
    select 'd6000000-0000-0000-0000-00000000000b', 'terms_brand v' || version, 'P6 Signer',
           'c6000000-0000-0000-0000-000000000002', id
      from public.current_legal_documents() where kind = 'terms_brand'$$,
  'a company signs the exact version it was shown'
);

select throws_ok(
  $$insert into public.terms_acceptances (org_id, terms_version, signature, accepted_by, legal_document_id)
    select 'd6000000-0000-0000-0000-00000000000b', 'privacy', 'P6 Signer',
           'c6000000-0000-0000-0000-000000000002', id
      from public.current_legal_documents() where kind = 'privacy'$$,
  '42501', null, 'but a privacy policy is not something anyone signs'
);

-- ---------------------------------------------------------------------------
-- Staff read the history, and still cannot write
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c6000000-0000-0000-0000-000000000001","email":"p6-admin@example.com","role":"authenticated"}';

select cmp_ok(
  (select count(*)::int from public.legal_documents),
  '>=', 4,
  'staff can read the version history'
);

select throws_ok(
  $$update public.legal_documents set full_en = 'rewritten'$$, '42501',
  null, 'but staff cannot rewrite a signed version either'
);

-- ---------------------------------------------------------------------------
-- The table's own guards, for whoever writes the next migration
-- ---------------------------------------------------------------------------

set local role postgres;

select throws_ok(
  $$insert into public.legal_documents (kind, version, full_en) values ('terms_brand', 999, 'Title
Sub')$$, '23514',
  null, 'terms without an onboarding version are refused, since onboarding shows them'
);

select throws_ok(
  $$insert into public.legal_documents (kind, version, full_en) values ('cookie_policy', 1, 'x')$$, '23514',
  null, 'an unknown kind is refused'
);

select * from finish();

rollback;
