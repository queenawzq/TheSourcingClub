-- A Chinese number in the wrong format names the letters a Unified Social
-- Credit Code never uses, as before 20261126100000. The same sentence as
-- EXPECTED_FORMAT in src/shared/registration-number.mjs; where a company finds
-- its number is said only by the company's own screens, not here, because
-- staff see this sentence too. Same signature; grants unchanged.

create or replace function public.registration_number_format_text(country text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case country
    when 'CN' then 'A Unified Social Credit Code has 18 characters, e.g. 91330100MA2B7C4D3F, without the letters I, O, S, V or Z'
    when 'TR' then 'A Turkish company tax number (VKN) has 10 digits, e.g. 4837261591'
    when 'PT' then 'A Portuguese company number has 9 digits, e.g. 519211596'
  end
$$;
