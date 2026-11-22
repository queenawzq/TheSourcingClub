-- ============================================================================
-- Where a Stripe withdrawal went, as the company reads it
-- ----------------------------------------------------------------------------
-- The server stores the payout's destination as the factory's list says it
-- ("Bank account ending in 0154", and the bank's name when Stripe has one)
-- when the withdrawal is made, so every member's list shows it without
-- reading the Stripe account's methods (owners only). Members already read
-- their company's rows; nothing here is writable by clients.
-- Safe with the live site while applied: two new nullable columns.
-- ============================================================================
alter table public.stripe_withdrawals add column if not exists destination_label text;
alter table public.stripe_withdrawals add column if not exists destination_bank text;
comment on column public.stripe_withdrawals.destination_label is
  'Where the payout went, in the list''s words: "Bank account ending in 0154" / "Debit card ending in 4242". Recorded by the server.';
comment on column public.stripe_withdrawals.destination_bank is
  'The bank''s name Stripe gave for that account, when it has one.';
