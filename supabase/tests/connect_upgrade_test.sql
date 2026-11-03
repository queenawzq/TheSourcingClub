begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
set local session_replication_role=replica;
insert into public.orgs(id,type,name,slug) values
 ('32000000-0000-0000-0000-000000000001','factory','Upgrade fixture','pgtap32-upgrade');
insert into public.stripe_connect_accounts(org_id,stripe_account_id,country) values
 ('32000000-0000-0000-0000-000000000001','acct_upgrade_fixture_old','PT');
set local session_replication_role=origin;
select lives_ok($$select public.begin_connect_upgrade('32000000-0000-0000-0000-000000000001','acct_upgrade_fixture_old')$$,'begin upgrade');
select lives_ok($$select public.begin_connect_upgrade('32000000-0000-0000-0000-000000000001','acct_upgrade_fixture_old')$$,'repeat start is safe');
update public.stripe_connect_upgrades set new_account_id='acct_upgrade_fixture_new' where org_id='32000000-0000-0000-0000-000000000001';
select throws_ok($$select public.finish_connect_upgrade('32000000-0000-0000-0000-000000000001','acct_upgrade_fixture_new','PT',false,false,false,'{}')$$,
 'P0001','Finish verification first.','cannot activate an unverified account');
select lives_ok($$select public.finish_connect_upgrade('32000000-0000-0000-0000-000000000001','acct_upgrade_fixture_new','PT',true,true,true,'{}')$$,'verified switch succeeds');
select is((select stripe_account_id from public.stripe_connect_accounts where org_id='32000000-0000-0000-0000-000000000001'),'acct_upgrade_fixture_new','new account is current');
select is((select old_account_id from public.stripe_connect_upgrades where org_id='32000000-0000-0000-0000-000000000001'),'acct_upgrade_fixture_old','old account retained for history');
set local role authenticated;
select throws_ok($$select public.begin_connect_upgrade('32000000-0000-0000-0000-000000000001','acct_upgrade_fixture_new')$$,'42501',null,'browser cannot start privileged migration directly');
select is((select count(*)::integer from public.stripe_connect_upgrades where org_id='32000000-0000-0000-0000-000000000001'),0,'unrelated users cannot read upgrade state');
reset role;
select * from finish();
rollback;
