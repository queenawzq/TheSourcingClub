begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(not has_table_privilege('anon','public.factory_title_translation_cache','SELECT'), 'Anonymous callers cannot read title cache');
select ok(not has_table_privilege('authenticated','public.factory_title_translation_cache','SELECT'), 'Signed-in clients cannot read cached titles directly');
select ok(has_table_privilege('service_role','public.factory_title_translation_cache','SELECT,INSERT,UPDATE'), 'Server can manage title cache');
select * from finish();
rollback;
