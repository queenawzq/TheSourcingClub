-- ============================================================================
-- Payments through Stripe: two new payment states
-- ----------------------------------------------------------------------------
-- A bank payment (US ACH Direct Debit) takes about four business days to
-- clear and can still fail after it was sent, so a payment needs a state for
-- "submitted, not cleared" and one for "came back".
--
--   processing  the brand paid by bank; Stripe is waiting for it to clear
--   failed      the payment did not go through; the brand can pay again
--
-- Alone in this file on purpose: a value added to an enum cannot be used in
-- the transaction that adds it, and each migration file runs as one
-- transaction. The next file uses both.
-- ============================================================================

alter type public.payment_state add value if not exists 'processing' after 'sent';
alter type public.payment_state add value if not exists 'failed' after 'processing';
