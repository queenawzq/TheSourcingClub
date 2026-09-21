-- ============================================================================
-- Legal documents — who may publish, who may read, and what a signature says
-- ----------------------------------------------------------------------------
-- Sixth suite, `pgtap6-` prefixed, every assertion scoped to its own fixtures
-- or to a version number read before it was changed.
--
-- current_legal_documents() is the one function granted to anon, which makes
-- the negatives here the point: the table stays unreadable to everyone but
-- staff, nobody else can publish, and nobody at all can rewrite a version a
-- company has already signed.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email) values
  ('c6000000-0000-0000-0000-000000000001', 'p6-admin@example.com'),
  ('c6000000-0000-0000-0000-000000000002', 'p6-brand@example.com');

insert into public.platform_admins (user_id, note)
values ('c6000000-0000-0000-0000-000000000001', 'pgtap6 fixture');

insert into public.orgs (id, type, name, slug) values
  ('d6000000-0000-0000-0000-00000000000b', 'brand', 'P6 Brand', 'pgtap6-brand');

insert into public.org_members (org_id, user_id, role) values
  ('d6000000-0000-0000-0000-00000000000b', 'c6000000-0000-0000-0000-000000000002', 'owner');

-- Read before any role change, so later assertions compare against whatever
-- another suite or an earlier admin left behind rather than assuming v1.
create temporary table p6_before on commit drop as
  select kind, max(version) as version from public.legal_documents group by kind;
grant select on p6_before to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signed out: the current text, and nothing else
-- ---------------------------------------------------------------------------

set local role anon;

select is(
  (select count(distinct kind)::int from public.current_legal_documents()),
  4,
  'a signed-out visitor can read the current version of every document'
);

select throws_ok(
  $$select count(*) from public.legal_documents$$, '42501',
  null, 'but not the table behind it'
);

select throws_ok(
  $$select public.publish_legal_document('privacy', null, null, 'x', null)$$, '42501',
  null, 'and cannot publish'
);

-- ---------------------------------------------------------------------------
-- A signed-in company
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c6000000-0000-0000-0000-000000000002","email":"p6-brand@example.com","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.publish_legal_document('terms_brand', 'Heading
Body', null, 'Title
Sub', null)$$, '42501',
  null, 'a company cannot publish the terms it signs'
);

select is(
  (select count(*)::int from public.legal_documents),
  0,
  'nor read the version history, which says who published what'
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
-- Staff
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c6000000-0000-0000-0000-000000000001","email":"p6-admin@example.com","role":"authenticated"}';

select is(
  (select version from public.publish_legal_document('terms_brand', 'P6 heading
P6 body', 'P6 标题
P6 正文', 'P6 Brand Terms
Effective today', '  ')),
  (select version + 1 from p6_before where kind = 'terms_brand'),
  'an admin publish is the next version'
);

select is(
  (select onboarding_en from public.current_legal_documents() where kind = 'terms_brand'),
  E'P6 heading\nP6 body',
  'and becomes the current one'
);

select is(
  (select full_zh from public.current_legal_documents() where kind = 'terms_brand'),
  null,
  'a blank Chinese page is stored as absent, so readers fall back to English'
);

select isnt(
  (select onboarding_en from public.legal_documents d
     join p6_before b on b.kind = d.kind and b.version = d.version
    where d.kind = 'terms_brand'),
  E'P6 heading\nP6 body',
  'the version a company signed is untouched'
);

select is(
  (select published_by from public.legal_documents
    where kind = 'terms_brand' order by version desc limit 1),
  'c6000000-0000-0000-0000-000000000001'::uuid,
  'and staff can see who published the new one'
);

select throws_ok(
  $$select public.publish_legal_document('terms_brand', 'Heading
Body', null, '   ', null)$$, '23514',
  null, 'a blank full document is refused'
);

select throws_ok(
  $$select public.publish_legal_document('terms_factory', '', null, 'Title
Sub', null)$$, '23514',
  null, 'terms without an onboarding version are refused, since onboarding shows them'
);

select is(
  (select onboarding_en from public.publish_legal_document('privacy', 'ignored', 'ignored', 'P6 Privacy
Sub', null)),
  null,
  'a privacy policy keeps no onboarding version'
);

select throws_ok(
  $$select public.publish_legal_document('cookie_policy', null, null, 'x', null)$$, '22023',
  null, 'an unknown kind is refused'
);

select * from finish();

rollback;
