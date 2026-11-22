import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { connectAction } from "../../lib/domain/stripe.js";
import { figuresAskGap, stripeWithdrawalMoved } from "./payment-summary.mjs";
import { balanceReader, nextBalanceState } from "./balance-reader.mjs";

/**
 * The factory's balance, read one way (/api/stripe-connect `figures`) by the
 * Payments page, its card and the Withdraw dialogs, owner and member alike:
 * the figures, what each road can reach, the PayPal / Wise withdrawals, and
 * for an owner its Stripe account's balance, payouts and methods. Every
 * figure is the server's; nothing here adds or merges amounts.
 *
 * Asked on load, and again when money moves: one realtime channel on the
 * tables a figure depends on (RLS applies per subscriber). How asks are made
 * (one at a time, in order, changes close together as one; where the read
 * asks Stripe, a member's at most once a minute and an owner's every 12 s)
 * and what a failure keeps is balance-reader.mjs. Only the load asks with
 * `load`: an owner's read then also keeps Stripe's automatic payouts off.
 * Answers are kept per company: one for a company left behind is dropped.
 *
 *   answer   undefined until the first answer; then the last one (one with
 *            `error` is the server's fallback); null when nothing came
 *   failure  the last ask's failure, if it failed
 *   reload   ask now: resolves to the answer this ask got, or null
 *   reset    forget the answer (figures wait again) and ask now
 *   request  ask soon, as a money change does
 *
 * `onMoneyChange` runs when the answer to a change heard lands, for the
 * rows a page reads itself, so rows and the words read from the answer move
 * together. `live` false: no channel (a dialog mounted for one action).
 */
export function useFactoryBalance(orgId, { enabled = true, live = true, isOwner = false, onMoneyChange = null } = {}) {
  const [kept, setState] = useState({ orgId, answer: undefined, failure: null });
  const state = kept.orgId === orgId ? kept : { orgId, answer: undefined, failure: null };
  const answerNow = useRef(undefined);
  answerNow.current = state.answer;
  const ownerNow = useRef(isOwner);
  ownerNow.current = isOwner;
  const changed = useRef(onMoneyChange);
  changed.current = onMoneyChange;
  const reader = useMemo(() => {
    let loaded = false;
    return balanceReader({
      fetchAnswer: () => {
        const load = !loaded;
        loaded = true;
        return connectAction(orgId, "figures", load ? { load: true } : {});
      },
      // An answer for a company no longer shown is never applied.
      apply: (event) => setState((was) => ({ orgId, ...nextBalanceState(was.orgId === orgId ? was : null, event) })),
      gap: () => figuresAskGap({ isOwner: ownerNow.current, readsStripe: Boolean(answerNow.current?.readsStripe) }),
      landed: () => changed.current?.(),
    });
  }, [orgId]);

  useEffect(() => {
    if (!enabled || !orgId) return undefined;
    reader.ask();
    if (!live) return undefined;
    const heard = () => reader.request();
    // A Stripe withdrawal is heard only when more than its lease changed: a
    // call taking or giving up its lease moves no money, and asking again on
    // that made a page and a withdrawal that would not settle feed each other.
    const seen = new Map();
    const channel = supabase
      .channel(`factory-balance:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_payments" }, heard)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "order_payments" }, heard)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "production_orders" }, heard)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "provider_payouts" }, heard)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "provider_payouts" }, heard)
      .on("postgres_changes", { event: "*", schema: "public", table: "factory_withdrawals", filter: `org_id=eq.${orgId}` }, heard)
      .on("postgres_changes", { event: "*", schema: "public", table: "stripe_withdrawals", filter: `org_id=eq.${orgId}` }, (payload) => {
        if (stripeWithdrawalMoved(seen, payload)) heard();
      })
      .subscribe();
    return () => {
      reader.cancel();
      supabase.removeChannel(channel);
    };
  }, [reader, orgId, enabled, live]);

  return { answer: state.answer, failure: state.failure, reload: reader.ask, reset: reader.reset, request: reader.request };
}
