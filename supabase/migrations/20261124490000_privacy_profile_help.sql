-- ============================================================================
-- Privacy policy, next version: help filling in a profile.
-- ----------------------------------------------------------------------------
-- Two things a company types into its profile now go to the AI model, through
-- OpenRouter, neither of them named yet:
--   - the address it types (Factory Address / Company Address), split into
--     street, city and country (api/structure-address.js, 20261124400000);
--   - the production dates it types on a quote's capacity window, when the
--     form cannot read them itself (api/parse-capacity-window.js).
--
-- The count of uses ("for four things") goes: the paragraphs after it name
-- more uses than one number can keep up with.
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
  ai_old  constant text := 'We use an AI model provider, through OpenRouter, for four things.';
  ai_new  constant text := 'We use an AI model provider, through OpenRouter, in the following ways.';
  brief   constant text := 'A sourcing brief may be drafted from your description.';
  filling constant text := ' When a company fills in its profile or a quote, the address or production dates it types may be sent to the model to put them in the right fields.';
  list_old constant text := 'OpenRouter for translation, drafting, message screening, help with profile reviews and reading registration documents;';
  list_new constant text := 'OpenRouter for translation, drafting, message screening, help with filling in and reviewing profiles and reading registration documents;';
begin
  select d.version, d.full_en into current_version, current_text
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if current_text is null then
    raise exception 'privacy policy is missing';
  end if;
  if position(ai_old in current_text) = 0 or position(brief in current_text) = 0 or position(list_old in current_text) = 0 then
    raise exception 'privacy policy v% does not read as expected; write the next version by hand', current_version;
  end if;

  next_text := replace(current_text, ai_old, ai_new);
  next_text := replace(next_text, brief, brief || filling);
  next_text := replace(next_text, list_old, list_new);

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', current_version + 1, null, null, next_text, null);
end;
$$;
