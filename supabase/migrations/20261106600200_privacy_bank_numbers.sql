-- ============================================================================
-- Privacy policy, next version: bank account numbers.  DRAFT WORDING FOR JOHN.
-- ----------------------------------------------------------------------------
-- A published version can never change, so this stays the last commit of its
-- PR and is replaced if John words it differently. A new row; earlier versions
-- stay as they were. English only, like every earlier version; nobody signs
-- anything new. Numbered after whatever is current.
--
-- Three sentences John should read closely:
--   - "administrators": true and uncomfortable (service_role and the database
--     password read Vault with no record). Saying less would be simpler and
--     less honest.
--   - "our bank": TSC's bank is not named, because which bank is undecided. The
--     policy names every processor, so it may need naming.
--   - How long a removed number lasts in backups is not stated: not confirmed.
-- ============================================================================

do $$
declare
  current_version integer;
  current_text    text;
  payoneer_ends constant text := $t$We never receive the company's Payoneer sign-in or balance, and brands cannot see this email address.$t$;
  bank_numbers constant text := $t$

Where Stripe cannot pay out to a factory or trading company, it may instead give us its bank details so that we can pay it by bank transfer: the account holder's name, the bank, the full account number or IBAN, the SWIFT or BIC code, the branch, and any transfer instructions. We keep the full account number encrypted and apart from the rest of the company's details. Our staff can read it only one account at a time, only when we owe that company a payout and need it to send the payment, and we record who read it and when. We give those details to our bank to make the payment. Other people at the company see only the last four digits, and brands cannot see any of these details. People who administer our database and servers have the technical ability to read the number; we limit who they are. We keep the number until the company replaces or removes it, or its account is deleted. We also keep a record of each transfer: the account holder, the bank, the last four digits and the bank's reference.$t$;
begin
  select d.version, d.full_en into current_version, current_text
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if current_text is null then
    raise exception 'privacy policy is missing';
  end if;
  if position(payoneer_ends in current_text) = 0 then
    raise exception 'privacy policy v% does not read as expected; write the next version by hand', current_version;
  end if;

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', current_version + 1, null, null,
    replace(current_text, payoneer_ends, payoneer_ends || bank_numbers),
    null);
end;
$$;
