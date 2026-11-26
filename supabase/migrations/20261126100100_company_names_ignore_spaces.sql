-- A company's name matches when it is the same name once the legal form,
-- case, accents, punctuation and every space are ignored (Nov 26):
-- "Hellstitch Lda" and "HELL STITCH - UNIPESSOAL LDA" are the same company.
-- A few more legal forms are dropped too (bv, nv, sas, sarl, ab, oy, pvt,
-- private, pte, kg, ag, ug, bhd, sdn).
--
-- Same rules as companyNameKey() / companyNamesMatch() in
-- src/shared/registration-number.mjs (`npm run check:registration`).
-- Same signatures; create or replace keeps the grants, restated below.

create or replace function public.company_name_key(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with plain as (
    -- Every accent off (ç, ş, ğ, ö, ệ, ạ …), then the letters NFD keeps whole.
    select translate(regexp_replace(normalize(lower(replace(coalesce(raw, ''), 'İ', 'i')), NFD), '[̀-ͯ]', '', 'g'),
                     'đıøłßæœ', 'diolsao') as v
  ), chinese as (
    select regexp_replace(v, '(股份有限公司|有限责任公司|有限公司|分公司|公司|厂)$', '') as v from plain
  ), words as (
    select ' ' || regexp_replace(v, '[^[:alnum:]]+', ' ', 'g') || ' ' as v from chinese
  ), phrases as (
    select regexp_replace(v, ' (cong ty|trach nhiem huu han|mot thanh vien|co phan|s a|a s|b v|n v)(?= )', ' ', 'g') as v from words
  ), forms as (
    select regexp_replace(v,
      ' (sa|sl|lda|limitada|unipessoal|sociedade|anonima|ltd|ltda|limited|co|company|corp|corporation|inc|llc|gmbh|plc|jsc|srl|spa|sti|sirketi|ticaret|sanayi|san|tic|ve|as|ith|ihr|imalat|pazarlama|and|e|cia|comercio|industria|tnhh|mtv|bv|nv|sas|sarl|ab|oy|pvt|private|pte|kg|ag|ug|bhd|sdn)(?= )',
      ' ', 'g') as v from phrases
  )
  select trim(regexp_replace(v, '\s+', ' ', 'g')) from forms
$$;
grant execute on function public.company_name_key(text) to authenticated, service_role;

create or replace function public.company_names_match(a text, b text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(public.company_name_key(a), ' ', '') <> ''
     and replace(public.company_name_key(a), ' ', '') = replace(public.company_name_key(b), ' ', '')
$$;
grant execute on function public.company_names_match(text, text) to authenticated, service_role;
