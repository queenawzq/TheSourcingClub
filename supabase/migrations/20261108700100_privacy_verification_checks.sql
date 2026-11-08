-- ============================================================================
-- Privacy policy, next version: how a factory's registration is checked.
-- ----------------------------------------------------------------------------
-- Verification v2 (Nov 8) sends three new things to processors, and the policy
-- names every processor:
--   - the uploaded registration document (business licence, tax registration
--     letter, permanent certificate) to the AI model, through OpenRouter, so
--     staff see its fields copied out (approved by Youssef, Nov 8);
--   - a Portuguese company's tax number to the EU's VIES service (#88);
--   - the company's address to OpenStreetMap's Nominatim, to place it on the
--     map, and the map tags around it to the AI model (never the address).
--
-- A new row; earlier versions stay. English only, like every earlier version;
-- nobody signs anything new. The edit refuses to run on text that does not
-- read as expected, so a changed policy is written by hand instead.
-- ============================================================================

do $$
declare
  current_version integer;
  current_text    text;
  next_text       text;
  ai_old constant text := 'We use an AI model provider, through OpenRouter, for four things.';
  ai_tail constant text := 'These suggestions are only an aid: a person at The Sourcing Club makes every review decision.';
  list_old constant text := 'OpenRouter for translation, drafting, message screening and help with profile reviews;';
  checks constant text := $t$

When a factory or trading company applies, we check that it is the company it says it is. Its registration document (for example a business licence, a tax registration letter or a permanent certificate) may be sent to the AI model, through OpenRouter, which copies out the fields printed on it, such as the registration number, the company's name, its legal representative, its address and its business activities, so that our staff can compare them with what the company told us. For a company registered in Portugal, its tax number is sent to the European Commission's VIES service, which answers whether the number is registered for VAT and under what name and address. The company's address is sent to OpenStreetMap's Nominatim service to place it on a map, and the descriptions of the land and buildings around that place (not the address) may be sent to the AI model to suggest whether it is an industrial, commercial or residential area. Our staff may also open public search pages, such as a company registry, a certification body's lookup or an image search, with the company's registration number, certificate number or the address of one of its public photos. These checks are only an aid: a person at The Sourcing Club makes every review decision.$t$;
begin
  select d.version, d.full_en into current_version, current_text
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if current_text is null then
    raise exception 'privacy policy is missing';
  end if;
  if position(ai_old in current_text) = 0 or position(ai_tail in current_text) = 0 or position(list_old in current_text) = 0 then
    raise exception 'privacy policy v% does not read as expected; write the next version by hand', current_version;
  end if;

  next_text := replace(current_text, ai_tail, ai_tail || checks);
  next_text := replace(next_text, list_old,
    'OpenRouter for translation, drafting, message screening, help with profile reviews and reading registration documents; the European Commission''s VIES service to check Portuguese tax numbers; OpenStreetMap''s Nominatim service to place company addresses on a map;');

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', current_version + 1, null, null, next_text, null);
end;
$$;
