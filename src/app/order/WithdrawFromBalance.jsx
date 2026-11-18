import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import { useUiLanguage } from "../../lib/ui-language.js";
import { FEE_FORMULAS, withdrawalFee } from "../../shared/withdrawal-fees.mjs";
import { methodProviderOn, providerOf } from "./payout-providers.js";

/**
 * A factory paid by Wise or PayPal withdraws from its balance:
 * approved earnings, less what it has asked for or been paid. The balance is
 * the database's (my_withdrawal_balance, one source with the staff board); the
 * request and its cancelling are RPCs that check the owner, the amount and the
 * one open request again. The fee shown is the one fee rule
 * (src/shared/withdrawal-fees.mjs); staff's approval uses the same rule with
 * the provider's own quote where it gives one.
 */

// A bank account is withdrawn to only through Wise: TSC no longer pays one by hand (20261117500000).
const usable = (row) => row?.method === "paypal"
  ? Boolean(row.paypal_email)
  : row?.method === "bank" && Boolean(row.wise_recipient_type && row.account_name?.trim() && row.number_changed_at);

const REFUSALS = {
  withdraw_owner_only: "Only a company owner can withdraw.",
  withdrawal_open: "You already have a withdrawal waiting. Cancel it first to ask for a different amount.",
  withdrawal_amount: "Enter an amount to withdraw.",
  withdrawal_over_balance: "That is more than your balance. Reload the page to see it.",
  withdrawal_method: "Choose one of your saved withdrawal methods, with its details complete.",
  withdrawal_not_waiting: "TSC has already started sending this, so it can no longer be cancelled.",
  withdrawal_none_chosen: "Choose at least one withdrawal to cancel.",
  withdrawal_provider_off: "This withdrawal method isn't available right now. Choose another one.",
};
const sentence = (error) => REFUSALS[error?.hint] ?? (error?.code === "PGRST301" || /JWT/i.test(error?.message ?? "")
  ? "Your sign-in expired. Sign in again."
  : "That didn't go through. Reload the page and try again.");

const TIMING = {
  wise: "Sent by Wise after TSC approves it; usually 1–2 business days to arrive.",
  paypal: "Sent by PayPal after TSC approves it; usually reaches your PayPal balance within minutes.",
};
export const withdrawalTiming = (provider) => TIMING[provider] ?? null;

const dollars = (cents) => `US$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
/**
 * The rate beside the fee, from the fee module's own formulas: "2%",
 * "US$0.25 per payment"; for a quoted fee, its share of
 * the amount.
 */
export function feeRate(provider, { country = "", feeCents, amountCents }) {
  if (provider === "paypal") {
    const f = FEE_FORMULAS.paypal;
    return country === f.home ? `${dollars(f.domesticFixedCents)} per payment` : `${f.bps / 100}%`;
  }
  if (!(amountCents > 0) || feeCents == null) return null;
  return `${Math.round((feeCents / amountCents) * 1000) / 10}%`;
}

/** The balance and the latest withdrawal, re-read when staff, a teammate or a brand approving a step change them. */
export function useWithdrawalBalance(orgId, enabled = true, defaultMethodId = null) {
  const [state, setState] = useState({ available: null, pool: false, open: null, opens: [], last: null, rows: [], withdrawn: new Map(), stripeFees: 0, error: null });
  const load = useCallback(async () => {
    if (!enabled || !orgId) return;
    const [balance, rows, stripeRows] = await Promise.all([
      supabase.rpc("my_withdrawal_balance", { target_org: orgId }),
      supabase.from("factory_withdrawals")
        .select("id, provider, status, amount_cents, currency, paid_to, fee_cents, receives_minor, receives_currency, reason, created_at, paid_at, updated_at")
        .eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
      // Stripe's payout fee, paid once per withdrawal from the Stripe balance
      // (api/_stripe-withdrawals.js), in US$. A fee given back is not counted.
      supabase.from("stripe_withdrawals").select("fee_cents").eq("org_id", orgId).eq("state", "paid_out"),
    ]);
    if (balance.error || rows.error || stripeRows.error) {
      setState((was) => ({ ...was, error: sentence(balance.error ?? rows.error ?? stripeRows.error) }));
      return;
    }
    const list = rows.data ?? [];
    // Several can be open at once; each already took its amount from the balance.
    const opens = list.filter((w) => ["requested", "paying"].includes(w.status));
    setState({
      available: Number(balance.data?.available_cents ?? 0),
      pool: Boolean(balance.data?.pool) || list.length > 0,
      open: opens[0] ?? null,
      opens,
      last: list[0] ?? null,
      rows: list,
      withdrawn: new Map(Object.entries(balance.data?.withdrawn ?? {}).map(([id, cents]) => [id, Number(cents)])),
      stripeFees: (stripeRows.data ?? []).reduce((sum, w) => sum + Number(w.fee_cents ?? 0), 0),
      error: null,
    });
  }, [orgId, enabled]);

  useEffect(() => {
    if (!enabled || !orgId) return undefined;
    load();
    const channel = supabase.channel(`factory-withdrawals:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "factory_withdrawals", filter: `org_id=eq.${orgId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "stripe_withdrawals", filter: `org_id=eq.${orgId}` }, () => load())
      // A brand approving a step moves its payment into the balance
      // (join_withdrawal_pool) with no factory_withdrawals row changing: the
      // first such payment is what reveals Withdraw. order_payments has no org
      // column to filter on; Realtime applies order_payments_read per
      // subscriber, so only this company's orders are heard.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_payments" }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "order_payments" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // Saving the first default method moves owed payments into the pool, even
  // though no factory_withdrawals row changes yet. Re-read after that save.
  }, [orgId, enabled, load, defaultMethodId]);

  return { ...state, load };
}

// The day it was asked for, in the reader's zone: two requests of the same
// amount to the same place are told apart by it.
const ASKED_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const askedOn = (w) => {
  const day = dateFrom(w.created_at);
  return day ? ` · ${ASKED_DAY.format(day)}` : "";
};
const destination = (w) => `${w.provider === "paypal" ? "PayPal" : w.provider === "wise" ? "Wise bank transfer" : "Bank transfer"}${w.paid_to ? ` · ${w.paid_to}` : ""}${askedOn(w)}`;

/**
 * A saved method in the "Withdraw to" list, in the page's language: the
 * language layer never rewrites a select's options. Names, emails and digits
 * stay as written.
 */
export const withdrawOptionLabel = (row, language = "en") => {
  const zh = language === "zh";
  if (row.method === "paypal") return zh ? `PayPal（${row.paypal_email}）` : `PayPal (${row.paypal_email})`;
  const name = row.bank_name || (zh ? "银行账户" : "Bank account");
  const wise = row.wise_recipient_type ? (zh ? "（Wise）" : " (Wise)") : "";
  return `${name}${wise}${zh ? " 尾号 " : " ending "}${row.account_number_last4 ?? ""}`.trim();
};

/**
 * Pending withdrawal details and the owner’s cancellation action: one row per
 * open withdrawal, oldest last. `onCancel(row)` cancels that one, or opens the
 * choice of which to cancel when more than one is still waiting.
 */
export function WithdrawalStatus({ open, opens, last, isOwner, onCancel, busy }) {
  const list = opens?.length ? opens : open ? [open] : [];
  if (list.length) {
    return list.map((row) => (
      <div className="payout-pending-withdrawal" data-testid="withdrawal-open" key={row.id}>
        <div className="payout-pending-details">
          <span className="payout-pending-label">Pending withdrawal</span>
          <span className="payout-pending-amount">{formatMoney(row.amount_cents, row.currency)}</span>
          <span className="payout-pending-destination">{destination(row)}</span>
        </div>
        {isOwner && row.status === "requested" ? <button className="secondary-btn compact-btn" type="button" disabled={busy} aria-label={busy ? undefined : `Cancel withdrawal of ${formatMoney(row.amount_cents, row.currency)}`} onClick={() => onCancel(row)}>{busy ? "Cancelling…" : "Cancel withdrawal"}</button> : <span className="billing-status">Processing</span>}
      </div>
    ));
  }
  if (last?.status === "declined") {
    return <p className="live-stripe-error" role="alert" data-testid="withdrawal-declined">{`Withdrawal of ${formatMoney(last.amount_cents, last.currency)} declined: ${last.reason}`}</p>;
  }
  if (last?.status === "failed") {
    return <p className="live-stripe-error" role="alert" data-testid="withdrawal-failed">{`Withdrawal of ${formatMoney(last.amount_cents, last.currency)} did not go through. The amount is back in your balance.`}</p>;
  }
  return null;
}

export async function cancelWithdrawal(id) {
  const { error } = await supabase.rpc("cancel_withdrawal", { target_withdrawal: id });
  if (error) throw new Error(sentence(error));
}

/** All or none: if one has started sending, none is cancelled. */
export async function cancelWithdrawals(ids) {
  const { error } = await supabase.rpc("cancel_withdrawals", { target_withdrawals: ids });
  if (error) throw new Error(sentence(error));
}

/**
 * The choice of which waiting withdrawals to cancel, in the payouts page's own
 * PayoutModal. `first` is ticked to start with (the row whose Cancel was pressed).
 */
export function CancelWithdrawalsForm({ opens, first, Modal, onClose, onDone }) {
  const waiting = opens.filter((w) => w.status === "requested");
  const [chosen, setChosen] = useState(() => new Set(first ? [first] : []));
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState(null);
  const ticked = waiting.filter((w) => chosen.has(w.id));
  const total = ticked.reduce((sum, w) => sum + Number(w.amount_cents), 0);
  const toggle = (id) => setChosen((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function confirm() {
    if (sending.current || busy || !ticked.length) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await cancelWithdrawals(ticked.map((w) => w.id));
      onDone();
    } catch (failure) {
      setError(failure.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="Cancel withdrawals" className="withdraw-form-modal" onClose={onClose} actions={<>
      <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Close</button>
      <button className="primary-btn" type="button" data-testid="cancel-withdrawals-confirm" disabled={busy || !ticked.length} onClick={confirm}>
        {busy ? "Cancelling…" : ticked.length > 1 ? `Cancel ${ticked.length} withdrawals` : "Cancel withdrawal"}
      </button>
    </>}>
      <fieldset className="cancel-withdrawals-list">
        <legend>Choose the withdrawals to cancel</legend>
        {waiting.map((w) => (
          <label className="cancel-withdrawals-option" key={w.id}>
            <input type="checkbox" name="Cancel withdrawal" value={w.id} checked={chosen.has(w.id)} disabled={busy} onChange={() => toggle(w.id)} />
            <span className="payout-pending-amount">{formatMoney(w.amount_cents, w.currency)}</span>
            <span className="payout-pending-destination">{destination(w)}</span>
          </label>
        ))}
      </fieldset>
      {ticked.length ? <p className="cancel-withdrawals-total">{`Back to your balance: ${formatMoney(total, "USD")}`}</p> : null}
      {error ? <p className="live-stripe-error" role="alert">{error}</p> : null}
    </Modal>
  );
}

/**
 * The exact fee and what arrives, from the provider, before the factory asks
 * (api/withdrawal.js "quote": owner only, read-only). Null while asking or
 * when the provider can't say; the dialog then shows the fee line.
 */
async function quoteFor(orgId, accountId, amountCents) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/withdrawal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ action: "quote", orgId, accountId, amountCents }),
  });
  if (!response.ok) return { exact: false };
  return response.json();
}

function useExactQuote(orgId, accountId, amountCents, enabled) {
  const [answer, setAnswer] = useState({ for: null, value: null });
  const key = enabled ? `${accountId}:${amountCents}` : null;
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      quoteFor(orgId, accountId, amountCents).catch(() => ({ exact: false })).then((value) => { if (live) setAnswer({ for: key, value }); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [key, orgId, accountId, amountCents]);
  return key && answer.for === key ? answer.value : null;
}

/** The dialog body and its Confirm, in the payouts page's own PayoutModal. */
export function WithdrawForm({ orgId, available, methods, defaultId, onDone, Modal, onClose, country = "", providers = null }) {
  // A saved method whose provider staff switched off stays saved, but is not offered.
  const choices = methods.filter((row) => usable(row) && methodProviderOn(providers, row));
  const [methodId, setMethodId] = useState((choices.find((m) => m.id === defaultId) ?? choices[0])?.id ?? "");
  const [amountText, setAmountText] = useState((available / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  // Several withdrawals may be open, so the database no longer stops a double
  // click: this does, before the state update reaches the button.
  const sending = useRef(false);
  const [error, setError] = useState(null);
  // A switch read or flipped after the dialog opened: the chosen method is no
  // longer offered. Never move to another one by itself: the choice is
  // cleared, and Withdraw stays off until the person chooses again.
  const offered = choices.map((m) => m.id).join(",");
  useEffect(() => {
    if (methodId && !choices.some((m) => m.id === methodId)) setMethodId("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered]);
  const method = choices.find((m) => m.id === methodId) ?? null;
  const provider = providerOf(method);
  const amountCents = /^\d+(\.\d{0,2})?$/.test(amountText.trim()) ? Math.round(Number(amountText.trim()) * 100) : NaN;
  const amountProblem = !Number.isFinite(amountCents) || amountCents <= 0 ? "Enter an amount to withdraw."
    : amountCents > available ? `You can withdraw up to ${formatMoney(available, "USD")}.` : null;
  const fee = amountProblem || !method ? null : withdrawalFee({ provider, amountCents, currency: "USD", country });
  // The provider's own figure when it can give one (Wise quotes per transfer);
  // otherwise the fee line, and the exact figure comes when TSC sends it.
  const exact = useExactQuote(orgId, method?.id, amountCents, Boolean(fee));
  const asking = Boolean(fee) && !exact;


  async function confirm() {
    if (sending.current || busy || amountProblem || !method || !fee || fee.refused || exact?.refused) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const { error: refused } = await supabase.rpc("request_withdrawal", { target_org: orgId, amount: amountCents, target_account: method.id });
    sending.current = false;
    setBusy(false);
    if (refused) return setError(sentence(refused));
    onDone();
  }

  const language = useUiLanguage();
  const label = (row) => withdrawOptionLabel(row, language);

  return (
    <Modal title="Withdraw" className="withdraw-form-modal" onClose={onClose} actions={<>
      <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary-btn" type="button" data-testid="withdraw-confirm" disabled={busy || asking || !method || Boolean(amountProblem) || !fee || Boolean(fee?.refused) || Boolean(exact?.refused)} onClick={confirm}>
        {busy ? "Withdrawing…" : Number.isFinite(amountCents) && amountCents > 0 ? `Withdraw ${formatMoney(amountCents, "USD")}` : "Withdraw"}
      </button>
    </>}>
      {/* Every saved method switched off by staff: nothing to choose, nothing to fill in. */}
      {!choices.length ? <p className="payout-modal-intro" data-testid="withdraw-no-method">Add another withdrawal method to withdraw.</p> : (
      <div className="withdraw-form-fields">
        <label className="payout-country-field withdraw-method-field">
          <span>Withdraw to</span>
          <select name="Withdraw to" value={methodId} disabled={busy} onChange={(event) => setMethodId(event.target.value)}>
            {methodId ? null : <option value="" />}
            {choices.map((row) => <option key={row.id} value={row.id}>{label(row)}</option>)}
          </select>
        </label>
        <div className="withdraw-amount-field payout-form-grid">
          <div className="withdraw-amount-heading">
            <label htmlFor="withdraw-amount">Amount (USD)</label>
            <button className="secondary-btn" type="button" disabled={busy} onClick={() => setAmountText((available / 100).toFixed(2))}>Withdraw full amount</button>
          </div>
          <input id="withdraw-amount" name="Amount (USD)" inputMode="decimal" value={amountText} disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              setAmountText(Number(value) > available / 100 ? (available / 100).toFixed(2) : value);
            }} aria-describedby="withdraw-available" />
          <p id="withdraw-available" className="withdraw-available">{`Available: ${formatMoney(available, "USD")}`}</p>
        </div>
      </div>
      )}
      {choices.length > 0 && amountText && amountProblem ? <p className="live-stripe-error" role="alert">{amountProblem}</p> : null}
      {fee?.refused || exact?.refused ? <p className="live-stripe-error" role="alert">{fee?.refused ?? exact.refused}</p> : null}
      {error ? <p className="live-stripe-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
