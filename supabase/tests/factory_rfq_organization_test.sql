begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
insert into auth.users(id,email) values
 ('bb250000-0000-0000-0000-000000000001','rfq-organizer@example.com'),
 ('bb250000-0000-0000-0000-000000000002','rfq-outsider@example.com');
insert into public.orgs(id,type,name,slug) values
 ('bb250000-0000-0000-0000-000000000003','factory','Organizer','test-rfq-organizer');
insert into public.org_members(org_id,user_id,role) values
 ('bb250000-0000-0000-0000-000000000003','bb250000-0000-0000-0000-000000000001','owner');
set local role authenticated;
set local request.jwt.claims = '{"sub":"bb250000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.factory_rfq_organization values ('bb250000-0000-0000-0000-000000000003','{"archived":["request"],"tabs":[{"key":"custom-test","label":"Test"}]}')$$, 'factory can save organization');
select is((select settings->'archived'->>0 from public.factory_rfq_organization where org_id='bb250000-0000-0000-0000-000000000003'), 'request', 'archive persists');
select lives_ok($$update public.factory_rfq_organization set settings='{"archived":[]}' where org_id='bb250000-0000-0000-0000-000000000003'$$, 'factory can restore');
set local request.jwt.claims = '{"sub":"bb250000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.factory_rfq_organization where org_id='bb250000-0000-0000-0000-000000000003'), 0::bigint, 'outsider cannot read private organization');
select * from finish();
rollback;
