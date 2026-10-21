-- Make the newly added quote_material_lines endpoint immediately available to
-- PostgREST after the preceding DDL migration.
select pg_notify('pgrst', 'reload schema');
