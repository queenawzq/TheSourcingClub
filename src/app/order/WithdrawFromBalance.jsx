import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { FEE_FORMULAS, withdrawalFee, withdrawalFeeLine } from "../../shared/withdrawal-fees.mjs";

/**
 * A factory paid by Wise, PayPal or bank transfer withdraws from its balance:
 * approved earnings, less what it has asked for or been paid. The balance is
 * the database's (my_withdrawal_balance, one source with the staff board); the
 * request and its cancelling are RPCs that check the owner, the amount and the
 * one open request again. The fee shown is the one fee rule
 * (src/shared/withdrawal-fees.mjs); staff's approval uses the same rule with
 * the provider's own quote where it gives one.
 */

const PROVIDER_FOR = (row) => (row?.method === "paypal" ? "paypal" : row?.wise_recipient_type ? "wise" : "bank");
const usable = (row) => row?.method === "paypal"
  ? Boolean(row.paypal_email)
  : row?.method === "bank" && Boolean(row.account_name?.trim() && row.number_changed_at);

const REFUSALS = {
  withdraw_owner_only: "Only a company owner can withdraw.",
  withdrawal_open: "You already have a withdrawal waiting. Cancel it first to ask for a different amount.",
  withdrawal_amount: "Enter an amount to withdraw.",
  withdrawal_over_balance: "That is more than your balance. Reload the page to see it.",
  withdrawal_method: "Choose one of your saved withdrawal methods, with its details complete.",
  withdrawal_not_waiting: "TSC has already started sending this, so it can no longer be cancelled.",
  fee_too_large: "This amount is not more than the bank transfer fee, so nothing would arrive.",
};
const sentence = (error) => REFUSALS[error?.hint] ?? (error?.code === "PGRST301" || /JWT/i.test(error?.message ?? "")
  ? "Your sign-in expired. Sign in again."
  : "That didn't go through. Reload the page and try again.");

const TIMING = {
  wise: "Sent by Wise after TSC approves it; usually 1–2 business days to arrive.",
  paypal: "Sent by PayPal after TSC approves it; usually reaches your PayPal balance within minutes.",
  bank: "Sent by bank transfer after TSC approves it; a few business days to arrive.",
};
export const withdrawalTiming = (provider) => TIMING[provider] ?? TIMING.bank;

const dollars = (cents) => `US$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
/**
 * The rate beside the fee, from the fee module's own formulas: "2%",
 * "US$0.25 per payment", "US$50 per payment"; for a quoted fee, its share of
 * the amount.
 */
export function feeRate(provider, { country = "", feeCents, amountCents }) {
  if (provider === "bank") return `${dollars(FEE_FORMULAS.bank.fixedCents)} per payment`;
  if (provider === "paypal") {
    const f = FEE_FORMULAS.paypal;
    return country === f.home ? `${dollars(f.domesticFixedCents)} per payment` : `${f.bps / 100}%`;
  }
  if (!(amountCents > 0) || feeCents == null) return null;
  return `${Math.round((feeCents / amountCents) * 1000) / 10}%`;
}

/** The balance and the latest withdrawal, re-read when staff or a teammate change them. */
export function useWithdrawalBalance(orgId, enabled = true) {
  const [state, setState] = useState({ available: null, pool: false, open: null, last: null, rows: [], withdrawn: new Map(), error: null });
  const load = useCallback(async () => {
    if (!enabled || !orgId) return;
    const [balance, rows] = await Promise.all([
      supabase.rpc("my_withdrawal_balance", { target_org: orgId }),
      supabase.from("factory_withdrawals")
        .select("id, provider, status, amount_cents, currency, paid_to, fee_cents, receives_minor, receives_currency, reason, created_at, paid_at, updated_at")
        .eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
    ]);
    if (balance.error || rows.error) {
      setState((was) => ({ ...was, error: sentence(balance.error ?? rows.error) }));
      return;
    }
    const list = rows.data ?? [];
    setState({
      available: Number(balance.data?.available_cents ?? 0),
      pool: Boolean(balance.data?.pool) || list.length > 0,
      open: list.find((w) => ["requested", "paying"].includes(w.status)) ?? null,
      last: list[0] ?? null,
      rows: list,
      withdrawn: new Map(Object.entries(balance.data?.withdrawn ?? {}).map(([id, cents]) => [id, Number(cents)])),
      error: null,
    });
  }, [orgId, enabled]);

  useEffect(() => {
    if (!enabled || !orgId) return undefined;
    load();
    const channel = supabase.channel(`factory-withdrawals:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "factory_withdrawals", filter: `org_id=eq.${orgId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, enabled, load]);

  return { ...state, load };
}

/**
 * "Withdrawal of $1,200.00 to a@b.c: Waiting for TSC.", with Cancel while it
 * waits. Each line is one whole sentence, so the Chinese layer can read it
 * (src/app/live-zh.js patterns).
 */
export function WithdrawalStatus({ open, last, isOwner, onCancel, busy }) {
  if (open) {
    const where = open.status === "paying" ? "TSC is sending it" : "Waiting for TSC";
    return (
      <p className="payout-balance-line" role="status" data-testid="withdrawal-open">
        <span>{`Withdrawal of ${formatMoney(open.amount_cents, open.currency)} to ${open.paid_to}: ${where}.`}</span>
        {isOwner && open.status === "requested" ? <> <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={onCancel}>Cancel withdrawal</button></> : null}
      </p>
    );
  }
  if (last?.status === "declined") {
    return <p className="live-stripe-error" role="alert" data-testid="withdrawal-declined">{`Withdrawal of ${formatMoney(last.amount_cents, last.currency)} declined: ${last.reason}`}</p>;
  }
  if (last?.status === "failed") {
    return <p className="live-stripe-error" role="alert" data-testid="withdrawal-failed">{`Withdrawal of ${formatMoney(last.amount_cents, last.currency)} did not go through. The amount is back in your balance.`}</p>;
  }
  if (last?.status === "paid" && Date.now() - new Date(last.paid_at).getTime() < 7 * 86400000) {
    const fee = last.fee_cents != null && last.receives_minor != null
      ? ` (fee ${formatMoney(last.fee_cents, last.currency)}; you receive ${formatMoney(last.receives_minor, last.receives_currency ?? last.currency)})` : "";
    return <p className="payout-balance-line" data-testid="withdrawal-paid">{`Paid out ${formatMoney(last.amount_cents, last.currency)} to ${last.paid_to}${fee}.`}</p>;
  }
  return null;
}

export async function cancelWithdrawal(id) {
  const { error } = await supabase.rpc("cancel_withdrawal", { target_withdrawal: id });
  if (error) throw new Error(sentence(error));
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
export function WithdrawForm({ orgId, available, methods, defaultId, onDone, Modal, onClose, country = "" }) {
  const choices = methods.filter(usable);
  const [methodId, setMethodId] = useState((choices.find((m) => m.id === defaultId) ?? choices[0])?.id ?? "");
  const [amountText, setAmountText] = useState((available / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const method = choices.find((m) => m.id === methodId) ?? null;
  const provider = PROVIDER_FOR(method);
  const amountCents = /^\d+(\.\d{0,2})?$/.test(amountText.trim()) ? Math.round(Number(amountText.trim()) * 100) : NaN;
  const amountProblem = !Number.isFinite(amountCents) || amountCents <= 0 ? "Enter an amount to withdraw."
    : amountCents > available ? `You can withdraw up to ${formatMoney(available, "USD")}.` : null;
  const fee = amountProblem || !method ? null : withdrawalFee({ provider, amountCents, currency: "USD", country });
  // The provider's own figure when it can give one (Wise quotes per transfer);
  // otherwise the fee line, and the exact figure comes when TSC sends it.
  const exact = useExactQuote(orgId, method?.id, amountCents, Boolean(fee) && provider !== "bank");
  const asking = Boolean(fee) && provider !== "bank" && !exact;
  const quoted = fee?.basis === "quote_needed" && !exact?.exact && !exact?.estimate;

  async function confirm() {
    if (busy || amountProblem || !method || !fee || fee.refused || exact?.refused) return;
    setBusy(true);
    setError(null);
    const { error: refused } = await supabase.rpc("request_withdrawal", { target_org: orgId, amount: amountCents, target_account: method.id });
    setBusy(false);
    if (refused) return setError(sentence(refused));
    onDone();
  }

  const label = (row) => (row.method === "paypal" ? `PayPal (${row.paypal_email})`
    : `${row.bank_name || "Bank account"}${row.wise_recipient_type ? " (Wise)" : ""} ending ${row.account_number_last4 ?? ""}`.trim());

  return (
    <Modal title="Withdraw" onClose={onClose} actions={<>
      <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary-btn" type="button" data-testid="withdraw-confirm" disabled={busy || asking || Boolean(amountProblem) || !fee || Boolean(fee?.refused) || Boolean(exact?.refused)} onClick={confirm}>
        {busy ? "Withdrawing…" : Number.isFinite(amountCents) && amountCents > 0 ? `Withdraw ${formatMoney(amountCents, "USD")}` : "Withdraw"}
      </button>
    </>}>
      <div className="payout-form-grid">
        <label>
          <span>Amount (USD)</span>
          <input name="Amount (USD)" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} aria-describedby="withdraw-available" />
        </label>
      </div>
      <p id="withdraw-available">{`Available: ${formatMoney(available, "USD")}`}</p>
      {amountText && amountProblem ? <p className="live-stripe-error" role="alert">{amountProblem}</p> : null}
      <label className="payout-country-field">
        <span>Withdraw to</span>
        <select name="Withdraw to" value={methodId} onChange={(event) => setMethodId(event.target.value)}>
          {choices.map((row) => <option key={row.id} value={row.id}>{label(row)}</option>)}
        </select>
      </label>
      {fee?.refused || exact?.refused ? <p className="live-stripe-error" role="alert">{fee?.refused ?? exact.refused}</p> : fee ? (
        <ul data-testid="withdraw-fee">
          {asking ? <li>Checking the fee…</li>
            : exact?.exact ? <>
              <li>{`Fee: ${formatMoney(exact.feeCents, "USD")} (${feeRate(provider, { country, feeCents: exact.feeCents, amountCents })}), taken from the amount`}</li>
              <li>{`You receive: ${formatMoney(exact.receivesMinor, exact.receivesCurrency ?? "USD")}`}</li>
            </> : exact?.estimate ? <>
              <li>{`Fee: about ${formatMoney(exact.feeCents, "USD")} (${feeRate(provider, { country, feeCents: exact.feeCents, amountCents })}), taken from the amount`}</li>
              <li>{`You receive: about ${formatMoney(exact.receivesMinor, exact.receivesCurrency ?? "USD")}`}</li>
              <li>The exact fee is shown when TSC sends it.</li>
            </> : quoted ? <>
              {/* No figure from Wise: its line, without the provider's word for the rate. */}
              <li>{withdrawalFeeLine(provider, { country: "US" })}</li>
              <li>The exact fee is shown when TSC sends it.</li>
            </> : <>
              <li>{`Fee: ${formatMoney(fee.feeCents, "USD")} (${feeRate(provider, { country, feeCents: fee.feeCents, amountCents })}), taken from the amount`}</li>
              <li>{`You receive: ${formatMoney(fee.receivesCents, "USD")}`}</li>
            </>}
          <li>{withdrawalTiming(provider)}</li>
        </ul>
      ) : null}
      {error ? <p className="live-stripe-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
