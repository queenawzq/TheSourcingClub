-- A registration number's typed label is dropped only in the country it
-- belongs to: Portugal "NIF", "NIPC", "N.º"; Turkey "VKN", "Vergi No"; China
-- "USCC" and "统一社会信用代码". Anywhere, "No:", "Nr:" or "Nº:" is dropped
-- only when a colon follows it. From 20261126100000, which dropped every
-- label in every country, so a number such as Norway's "NO 123456789 MVA"
-- lost its first letters. normaliseRegistrationNumber() in
-- src/shared/registration-number.mjs is the same rule.
--
-- Same signature; nothing stores the function's output in an index.

create or replace function public.normalise_registration_number(country text, raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with t as (
    select btrim(replace(upper(translate(public.strip_invisible(raw),
      '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ－．／　：＃',
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-./ :#')), 'İ', 'I'), E' \t\r\n') as v
  ), own as (
    -- The country's own label. A Latin one needs a space, colon, "#" or dot
    -- after it, so a number that starts with those letters keeps them.
    select case country
      when 'PT' then regexp_replace(v, '^(NIF/NIPC|NIPC|NIF|Nº|N\.º)(\s*[:#.]+\s*|\s+)(?=\S)', '')
      when 'TR' then regexp_replace(v, '^(VKN|VERGI NO|VERGI NUMARASI)(\s*[:#.]+\s*|\s+)(?=\S)', '')
      when 'CN' then regexp_replace(regexp_replace(v,
                       '^(统一社会信用代码|社会信用代码|信用代码)\s*:?\s*(?=\S)', ''),
                       '^(UNIFIED SOCIAL CREDIT CODE|USCC)(\s*[:#.]+\s*|\s+)(?=\S)', '')
      else v
    end as v
    from t
  ), labelled as (
    select regexp_replace(v, '^(NO|NR|Nº|N\.º)\s*:\s*(?=\S)', '') as v from own
  ), bare as (
    select regexp_replace(v, '[\s ./-]', '', 'g') as v from labelled
  )
  select case when country = 'PT' and v ~ '^PT\d{9}$' then substr(v, 3) else v end from bare
$$;
