-- ============================================================================
-- Privacy policy, next version: Wise and PayPal.  DRAFT WORDING FOR JOHN.
-- ----------------------------------------------------------------------------
-- The policy names every processor, and from now on the server gives a factory's
-- bank details to Wise, and its address to PayPal. Payoneer leaves the policy,
-- since nobody new is paid through it. Versions 5 and 6 are on qa and stay as
-- they are; they never reach anyone once this is the current version.
--
-- A new row; earlier versions stay. English only, like every earlier version;
-- nobody signs anything new.
--
-- Three things John should read closely:
--   - Rows already saved keep Payoneer on the staff board. If production ever has
--     one, this version stops naming a processor it used: production had 0 payout
--     rows on Nov 6, so check again at merge.
--   - "held in Wise": Wise keeps the account number as a recipient, under its own
--     policy, and we can't make it forget one from here.
--   - PayPal's and Wise's own policies are referred to by name only.
-- ============================================================================

do $$
declare
  current_version integer;
  current_text    text;
  next_text       text;
  payoneer_start constant text := 'Where Stripe cannot pay out to a factory or trading company, it may choose to be paid through Payoneer';
  payoneer_end   constant text := 'and brands cannot see this email address.';
  to_bank        constant text := 'We give those details to our bank to make the payment.';
  from_at integer;
  to_at integer;
  providers constant text := $t$Where Stripe cannot pay out to a factory or trading company, it may choose to be paid through Wise or PayPal. To pay through Wise we give Wise the bank details below, including the full account number, the amount and the payment details, and Wise holds them as a recipient and processes them under its own privacy policy. To pay through PayPal the company gives us the email address of its PayPal account, and we give PayPal that address, the amount and the payment details, and PayPal processes them under its own privacy policy. We keep the email address and the provider's reference as a record of the payout. We never receive the company's Wise or PayPal sign-in or balance, and brands cannot see these details.$t$;
begin
  select d.version, d.full_en into current_version, current_text
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if current_text is null then
    raise exception 'privacy policy is missing';
  end if;

  from_at := position(payoneer_start in current_text);
  to_at := position(payoneer_end in current_text);
  if from_at = 0 or to_at = 0 or position(to_bank in current_text) = 0
     or position('Payoneer for payouts where Stripe cannot pay out;' in current_text) = 0 then
    raise exception 'privacy policy v% does not read as expected; write the next version by hand', current_version;
  end if;

  next_text := left(current_text, from_at - 1) || providers
    || substr(current_text, to_at + length(payoneer_end));
  next_text := replace(next_text, 'Payoneer for payouts where Stripe cannot pay out;',
    'Wise and PayPal for payouts where Stripe cannot pay out;');
  next_text := replace(next_text, to_bank,
    'We give those details to Wise, or to our bank if a payment goes by hand, to make the payment.');

  if next_text ~* 'payoneer' then
    raise exception 'the next privacy policy still names Payoneer';
  end if;

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', current_version + 1, null, null, next_text, null);
end;
$$;
