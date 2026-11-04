begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users(id, email) values
('df000000-0000-0000-0000-000000000001', 'delete-staff@example.com'),
('df000000-0000-0000-0000-000000000002', 'delete-owner@example.com');
insert into public.platform_admins(user_id) values ('df000000-0000-0000-0000-000000000001');
insert into public.orgs(id, type, name, slug) values
('df000000-0000-0000-0000-000000000010', 'factory', 'Disposable Factory', 'pgtap-delete-disposable'),
('df000000-0000-0000-0000-000000000020', 'factory', 'Quoted Factory', 'pgtap-delete-quoted'),
('df000000-0000-0000-0000-000000000030', 'brand', 'Protected Brand', 'pgtap-delete-brand'),
('df000000-0000-0000-0000-000000000040', 'factory', 'Staff Factory', 'pgtap-delete-staff');
insert into public.factory_profiles(org_id) values
('df000000-0000-0000-0000-000000000010'), ('df000000-0000-0000-0000-000000000020');
insert into public.org_members(org_id, user_id, role) values
('df000000-0000-0000-0000-000000000010', 'df000000-0000-0000-0000-000000000002', 'owner'),
('df000000-0000-0000-0000-000000000040', 'df000000-0000-0000-0000-000000000001', 'owner');
insert into public.rfqs(id, brand_org_id, title) values
('df000000-0000-0000-0000-000000000050', 'df000000-0000-0000-0000-000000000030', 'Delete guard request');
insert into public.quotes(rfq_id, factory_org_id) values
('df000000-0000-0000-0000-000000000050', 'df000000-0000-0000-0000-000000000020');
insert into public.documents(org_id, kind, bucket, storage_path, file_name) values
('df000000-0000-0000-0000-000000000010', 'business_registration', 'org-private', 'df000000-0000-0000-0000-000000000010/business_registration/license.pdf', 'license.pdf'),
('df000000-0000-0000-0000-000000000010', 'certificate', 'org-private', 'df000000-0000-0000-0000-000000000020/certificate/other.pdf', 'bad-reference.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"df000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.admin_delete_factory('df000000-0000-0000-0000-000000000010', 'Disposable Factory')$$, '42501', null, 'Factory owner cannot delete companies');
set local request.jwt.claims = '{"sub":"df000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.admin_delete_factory('df000000-0000-0000-0000-000000000010', 'Wrong name')$$, '22023', null, 'Exact company name is required');
select throws_ok($$select public.admin_delete_factory('df000000-0000-0000-0000-000000000030', 'Protected Brand')$$, 'P0002', null, 'Brands cannot be deleted through factory cleanup');
select throws_ok($$select public.admin_delete_factory('df000000-0000-0000-0000-000000000040', 'Staff Factory')$$, '42501', null, 'Staff companies are protected');
select throws_ok($$select public.admin_delete_factory('df000000-0000-0000-0000-000000000020', 'Quoted Factory')$$, '22023', null, 'Quote history blocks deletion');
select lives_ok($$select public.admin_delete_factory('df000000-0000-0000-0000-000000000010', 'Disposable Factory')$$, 'Staff can delete an unused factory');
reset role;
select is((select count(*) from public.orgs where id = 'df000000-0000-0000-0000-000000000010'), 0::bigint, 'Factory company is removed');
select is((select count(*) from public.org_members where org_id = 'df000000-0000-0000-0000-000000000010'), 0::bigint, 'Company memberships are removed');
select is((select count(*) from auth.users where id = 'df000000-0000-0000-0000-000000000002'), 1::bigint, 'Individual account is kept');
select is((select jsonb_array_length(files) from public.admin_factory_deletions where org_id = 'df000000-0000-0000-0000-000000000010'), 1, 'Cleanup manifest excludes another company storage path');
select * from finish();
rollback;
