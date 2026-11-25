-- The review history lists staff's own check results and each decision
-- (20261124350000). Fixtures prefixed pgtap2435-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

set local tsc.skip_terms_guard = 'on';
set local tsc.skip_registry_guard = 'on';

insert into auth.users (id, email) values ('c2435000-0000-0000-0000-000000000001', 'p2435-admin@example.com');
insert into public.platform_admins (user_id) values ('c2435000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2435000-0000-0000-0000-0000000000f1', 'factory', 'P2435 Mill', 'pgtap2435-mill');
insert into public.factory_profiles (org_id, country_code) values ('d2435000-0000-0000-0000-0000000000f1', 'TR');

set local request.jwt.claims = '{"sub":"c2435000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select public.admin_record_signal('d2435000-0000-0000-0000-0000000000f1', 'address', null, 'confirmed', 'Seen on the map', '{"address":"Bornova, Izmir"}'::jsonb);
select public.admin_record_signal('d2435000-0000-0000-0000-0000000000f1', 'scope', null, 'factory', 'Sewing lines seen');
reset role;

select is((select details ->> 'result' from public.org_review_changes
            where org_id = 'd2435000-0000-0000-0000-0000000000f1' and kind = 'address_check'), 'confirmed', 'an address result is in the history');
select is((select details ->> 'note' from public.org_review_changes
            where org_id = 'd2435000-0000-0000-0000-0000000000f1' and kind = 'scope_check'), 'Sewing lines seen', 'with its note');
select is((select changed_by from public.org_review_changes
            where org_id = 'd2435000-0000-0000-0000-0000000000f1' and kind = 'scope_check'), 'c2435000-0000-0000-0000-000000000001'::uuid, 'and who');

-- An automatic result is not staff's.
insert into public.verification_signals (org_id, kind, result, automatic) values ('d2435000-0000-0000-0000-0000000000f1', 'address', 'industrial', true);
select is((select count(*)::int from public.org_review_changes
            where org_id = 'd2435000-0000-0000-0000-0000000000f1' and kind = 'address_check'), 1, 'the automatic address check is not added');

insert into public.org_reviews (org_id, state, decided_by, decided_at)
values ('d2435000-0000-0000-0000-0000000000f1', 'approved', 'c2435000-0000-0000-0000-000000000001', now());
select is((select details ->> 'state' from public.org_review_changes
            where org_id = 'd2435000-0000-0000-0000-0000000000f1' and kind = 'decision'), 'approved', 'the approval is in the history');

select * from finish();
rollback;
