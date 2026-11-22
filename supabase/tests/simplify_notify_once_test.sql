-- Notify once, by a key (20261121390000).
--
-- One factory, one approved step p ($1,000; the brand paid $1,070), disputed.
-- A hold is told once per amount, and never again for less; a refund
-- recorded twice is one event and one notice; a refund of another
-- PaymentIntent is one event, found by its Stripe id; the "earnings went
-- down" notice keeps its words; keys are unique per company and fixed.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;

insert into auth.users (id, email)
select ('c39a0000-0000-0000-0000-0000000000' || k)::uuid, 'pgtap-s2-' || k || '@example.com'
  from unnest(array['02','03','11','12']) k;
-- 02 is staff; 03 owns the brand; 11 owns fa, 12 owns fb.
insert into public.platform_admins (user_id, note) values ('c39a0000-0000-0000-0000-000000000002', 'pgtap-s2');
insert into public.orgs (id, type, name, slug) values
  ('c39b0000-0000-0000-0000-0000000000b1', 'brand', 'S2 Brand', 'pgtap-s2-brand'),
  ('c39b0000-0000-0000-0000-0000000000f1', 'factory', 'S2 Factory A', 'pgtap-s2-fa');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('c39b0000-0000-0000-0000-0000000000b1', 'c39a0000-0000-0000-0000-000000000003', 'owner', '{}'),
  ('c39b0000-0000-0000-0000-0000000000f1', 'c39a0000-0000-0000-0000-000000000011', 'owner', '{}');

-- Steps: n = factory (1 fa, 2 fb), k = step.
create temporary table s2_steps (n int, k int, amount bigint, refunded bigint, state text) on commit drop;
insert into s2_steps values (1, 1, 100000, 0, 'confirmed');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total)
select ('c39c0000-0000-0000-0000-0000000000' || n || k)::uuid, 'c39b0000-0000-0000-0000-0000000000b1',
       'S2 request ' || n || k, 'awarded', 'invited_only', 100 from s2_steps;
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at)
select ('c39c1000-0000-0000-0000-0000000000' || n || k)::uuid, ('c39c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid, 'accepted', 100, 1, now() from s2_steps;
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
select ('c39d0000-0000-0000-0000-0000000000' || n || k)::uuid, ('c39c0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c39c1000-0000-0000-0000-0000000000' || n || k)::uuid, 'c39b0000-0000-0000-0000-0000000000b1',
       ('c39b0000-0000-0000-0000-0000000000f' || n)::uuid, amount, 'active', now() - interval '60 days',
       'c39a0000-0000-0000-0000-000000000003', 1, amount, 0, amount, 50, 50, 'S2-' || n || k
  from s2_steps;
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at)
select ('c39e00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c39d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       'approval_and_payment'::public.milestone_type, 'S2 step ' || n || k, amount, 'complete'::public.milestone_state, 10,
       now() - interval '30 days'
  from s2_steps;
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, charged_cents, amount_received_cents, currency, state, confirmed_at, release_requested_at,
   stripe_payment_intent_id, stripe_charge_id, funds_available_at, released_at, released_note, refunded_cents, refund_amount_at)
select ('c39f00' || n || k || '-0000-0000-0000-000000000000')::uuid, ('c39d0000-0000-0000-0000-0000000000' || n || k)::uuid,
       ('c39e00' || n || k || '-0000-0000-0000-000000000000')::uuid, amount, amount * 107 / 100, amount * 107 / 100, 'USD',
       state::public.payment_state, now() - interval '40 days', now() - interval '30 days' + (n * 10 + k) * interval '1 minute',
       'pi_pgtap_s2_' || n || k, 'ch_pgtap_s2_' || n || k, now() - interval '35 days',
       case when state = 'released' then now() - interval '20 days' end,
       case when state = 'released' then 'BANKREF' end,
       refunded, case when refunded > 0 then now() - interval '5 days' end
  from s2_steps;
set local session_replication_role = origin;

create function pg_temp.p() returns public.order_payments language sql as $f$
  select * from public.order_payments where id = 'c39f0011-0000-0000-0000-000000000000';
$f$;
create function pg_temp.told(kind text) returns bigint language sql as $f$
  select count(*) from public.notifications where org_id = 'c39b0000-0000-0000-0000-0000000000f1' and notifications.kind = told.kind;
$f$;

update public.order_payments set disputed_at = now() - interval '1 hour' where id = 'c39f0011-0000-0000-0000-000000000000';
select public.tell_payment_hold(pg_temp.p(), true);
select public.tell_payment_hold(pg_temp.p(), true);
select is(pg_temp.told('payment_disputed'), 1::bigint, 'the hold is told once (webhook and withdraw call both)');
select ok((select dedupe_key from public.notifications where org_id = 'c39b0000-0000-0000-0000-0000000000f1' and kind = 'payment_disputed')
          like 'payment_hold:c39f0011-0000-0000-0000-000000000000:%:100000', 'its key: the payment, the dispute, the amount held');

-- A $107 refund (the factory's part $100): one event, one notice each side, in the same words as before.
select public.record_payment_refund_amount('c39f0011-0000-0000-0000-000000000000', 'pi_pgtap_s2_11', 10700);
select public.record_payment_refund_amount('c39f0011-0000-0000-0000-000000000000', 'pi_pgtap_s2_11', 10700);
select is((select count(*) from public.payment_events where payment_id = 'c39f0011-0000-0000-0000-000000000000' and stripe_ref = 'pi_pgtap_s2_11'), 1::bigint,
          'recorded once, with its Stripe id');
select is((select body from public.notifications where org_id = 'c39b0000-0000-0000-0000-0000000000f1' and kind = 'payment_refunded'),
          'The brand was refunded $107.00. Your earnings from S2 request 11 (S2-11) went down by $100.00.', 'the factory''s notice keeps its words (tell_earnings_down)');
select is(pg_temp.told('payment_refunded'), 1::bigint, 'and is told once');

-- Less is held now ($900): not told again (a larger amount already was).
select public.tell_payment_hold(pg_temp.p(), true);
select is(pg_temp.told('payment_disputed'), 1::bigint, 'a smaller held amount is not told again');

-- A refund of a payment that was not this step's own: one line for staff, by its Stripe id.
select public.record_payment_refund_amount('c39f0011-0000-0000-0000-000000000000', 'pi_pgtap_s2_other', 5000);
select public.record_payment_refund_amount('c39f0011-0000-0000-0000-000000000000', 'pi_pgtap_s2_other', 5000);
select is((select count(*) from public.payment_events where payment_id = 'c39f0011-0000-0000-0000-000000000000' and stripe_ref = 'pi_pgtap_s2_other'), 1::bigint,
          'another PaymentIntent''s refund: one line');
-- Its words are free to change: an event with the same note and another id does not count.
insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
values ('c39f0011-0000-0000-0000-000000000000', 'confirmed', 'confirmed', 'system', 'Any words (Stripe pi_pgtap_s2_third)');
select public.record_payment_refund_amount('c39f0011-0000-0000-0000-000000000000', 'pi_pgtap_s2_third', 5000);
select is((select count(*) from public.payment_events where payment_id = 'c39f0011-0000-0000-0000-000000000000' and stripe_ref = 'pi_pgtap_s2_third'), 1::bigint,
          'an event is found by its stripe_ref, not by its note');

-- Keys: unique per company, any number of notices without one, fixed once written.
insert into public.notifications (org_id, kind, title, body, dedupe_key)
values ('c39b0000-0000-0000-0000-0000000000f1', 'withdrawal', 't', 'b', 'withdrawal_asked:pgtap-s2');
select throws_ok($$insert into public.notifications (org_id, kind, title, body, dedupe_key)
                   values ('c39b0000-0000-0000-0000-0000000000f1', 'withdrawal', 't', 'b', 'withdrawal_asked:pgtap-s2')$$,
                 '23505', null, 'the same key twice for one company is refused');
select lives_ok($$insert into public.notifications (org_id, kind, title, body)
                  values ('c39b0000-0000-0000-0000-0000000000f1', 'withdrawal', 't', 'b'), ('c39b0000-0000-0000-0000-0000000000f1', 'withdrawal', 't', 'b')$$,
                'notices without a key are as before');
select lives_ok($$insert into public.notifications (org_id, kind, title, body, dedupe_key)
                  values ('c39b0000-0000-0000-0000-0000000000b1', 'withdrawal', 't', 'b', 'withdrawal_asked:pgtap-s2')$$,
                'another company may hold the same key');
select throws_ok($$update public.notifications set dedupe_key = null where dedupe_key = 'withdrawal_asked:pgtap-s2'$$,
                 '22023', 'a notification can only be marked read', 'a key cannot be changed');
select ok(not has_function_privilege('authenticated', 'public.tell_earnings_down(public.order_payments, public.production_orders, text, text, bigint, bigint)', 'execute'),
          'tell_earnings_down: not for clients');
select is((select count(*) from pg_proc where proname in ('record_payment_refunded', 'record_payment_refund_amount', 'record_payment_dispute_lost',
            'record_full_refund_failed', 'record_payment_refund_failed', 'admin_payment_board', 'tell_payment_hold', 'tell_withdrawal_refunded')
            and (prosrc ~ 'note like' or prosrc ~ 'title like' or prosrc ~ 'starts_with\(n\.body')), 0::bigint,
          'no once-only check reads a note, a title or a body any more');

select * from finish();
rollback;
