import React, { useEffect, useRef, useState } from "react";
import { SIGN_IN_ENDED, supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import { useUiLanguage } from "../../lib/ui-language.js";
import { FEE_FORMULAS, withdrawalFee } from "../../shared/withdrawal-fees.mjs";
import { methodProviderOn, providerOf } from "./payout-providers.js";
import { AWAITING_REVIEW, NOTHING_BACK, ON_HOLD, parseWithdrawAmount, reversedByBankLine, withdrawFeeLine } from "./payment-summary.mjs";
import { RELOAD_AND_TRY_AGAIN, SIGN_IN_AGAIN } from "./balance-reader.mjs";

/**
 * A factory withdraws to Wise or PayPal from its one balance: cleared
 * approved earnings, less what it has asked for or been paid (the balance
 * read's `reach.pool_cents`, balance-reader.mjs withdrawalsFrom). The request and its
 * cancelling are RPCs that check the owner, the amount and the one open
 * request again. The fee shown is the one fee rule
 * (src/shared/withdrawal-fees.mjs); staff's approval uses the same rule with
 * the provider's own quote where it gives one.
 */

// A bank account is withdrawn to only through Wise: TSC no longer pays one by hand (20261117500000).
export const usable = (row) => row?.method === "paypal"
  ? Boolean(row.paypal_email)
  : row?.method === "bank" && Boolean(row.wise_recipient_type && row.account_name?.trim() && row.number_changed_at);

const REFUSALS = {
  withdraw_owner_only: "Only a company owner can withdraw.",
  withdrawal_open: "You already have a withdrawal waiting. Cancel it first to ask for a different amount.",
  withdrawal_amount: "Enter an amount to withdraw.",
  withdrawal_over_balance: "That is more than your balance.",
  withdrawal_method: "Choose one of your saved withdrawal methods, with its details complete.",
  withdrawal_not_waiting: "TSC has already started sending this, so it can no longer be cancelled.",
  withdrawal_none_chosen: "Choose at least one withdrawal to cancel.",
  withdrawal_provider_off: "This withdrawal method isn't available right now. Choose another one.",
};
const sentence = (error) => REFUSALS[error?.hint] ?? (error?.code === "PGRST301" || /JWT/i.test(error?.message ?? "")
  ? SIGN_IN_AGAIN
  : RELOAD_AND_TRY_AGAIN);

export const ALREADY_CANCELLED = "This withdrawal was already cancelled.";
/** A saved method whose provider staff switched off: shown, never chosen. */
export const METHOD_OFF = "This withdrawal method isn't available right now.";
export const METHOD_OFF_CHOOSE = "This withdrawal method isn't available right now. Choose another one.";

/**
 * Why cancelling was refused. "Not waiting" is also what the database says
 * when someone (another tab, a teammate) has just cancelled it: read the rows
 * again and say that, not that TSC started sending it.
 */
export async function cancelRefusal(error, ids) {
  if (error?.hint === "withdrawal_not_waiting") {
    const { data } = await supabase.from("factory_withdrawals").select("id, status").in("id", ids);
    if (data?.length && data.every((w) => w.status === "cancelled")) return ALREADY_CANCELLED;
  }
  return sentence(error);
}

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
 * An open withdrawal's word on the card: the word its Transactions row says
 * (serverWithdrawalRows), from the server's `word` for it, so the card and the
 * row never give one withdrawal two states.
 */
export function openWithdrawalWord(row, word = null) {
  if (word === "on_hold") return ON_HOLD;
  if (word === "on_its_way") return "Processing";
  return word === "waiting" || (!word && row?.status === "requested") ? AWAITING_REVIEW : "Processing";
}

/**
 * Open withdrawal details and the owner’s cancellation action: one row per
 * open withdrawal, oldest last. `onCancel(row)` cancels that one, or opens the
 * choice of which to cancel when more than one is still waiting.
 */
export function WithdrawalStatus({ open, opens, last, isOwner, onCancel, busy, words = null, refunded = null, reversed = null, back = null, feeFor = null }) {
  const list = opens?.length ? opens : open ? [open] : [];
  if (list.length) {
    // The server's word for it (factory_balance().withdrawals): a request whose
    // step was refunded underneath is on hold, for the owner and members alike.
    const wordOf = (row) => openWithdrawalWord(row, words instanceof Map ? words.get(row.id) : null);
    // The fee the row shows, taken from it as the row takes it (feeFor: PayPal
    // while waiting or being sent; none for a quoted fee until it is paid).
    const feeOf = (row) => {
      const fee = typeof feeFor === "function" ? feeFor(row) : null;
      return Number.isFinite(fee) && fee > 0 ? fee : 0;
    };
    // The part of it refunded to the brand since it was asked (its parts'
    // "refunded"): no longer the factory's, so the block shows what it still
    // holds, and the refunded part on its own line.
    const refundedOf = (row) => Math.min(Number(row.amount_cents) || 0, Math.max(0, Number(refunded instanceof Map ? refunded.get(row.id) : 0) || 0));
    return list.map((row) => (
      <div className="payout-pending-withdrawal" data-testid="withdrawal-open" key={row.id}>
        <div className="payout-pending-details">
          <span className="payout-pending-label" data-testid="withdrawal-open-word">{wordOf(row)}</span>
          <span className="payout-pending-amount">{formatMoney(Number(row.amount_cents) - refundedOf(row) - feeOf(row), row.currency)}</span>
          {feeOf(row) > 0 ? <span className="payout-pending-destination" data-testid="withdrawal-fee">{`Fee ${formatMoney(feeOf(row), row.currency)}, taken from it`}</span> : null}
          {/* The brand's bank took part of it back (refund_cause "reversed"): the row's words for it. */}
          {refundedOf(row) > 0 ? <span className="payout-pending-destination" data-testid="withdrawal-refunded">{reversed instanceof Set && reversed.has(row.id)
            ? reversedByBankLine(formatMoney(refundedOf(row), row.currency)) : `${formatMoney(refundedOf(row), row.currency)} refunded`}</span> : null}
          <span className="payout-pending-destination">{destination(row)}</span>
        </div>
        {isOwner && row.status === "requested" ? <button className="secondary-btn compact-btn" type="button" disabled={busy} aria-label={busy ? undefined : `Cancel withdrawal of ${formatMoney(row.amount_cents, row.currency)}`} onClick={() => onCancel(row)}>{busy ? "Cancelling…" : "Cancel withdrawal"}</button>
          // Someone who can't cancel reads the word on the left; nothing to press.
          : null}
      </div>
    ));
  }
  if (last?.status === "declined") {
    return <NewOnly id={`${last.id}:declined`}><p className="live-stripe-error" role="alert" data-testid="withdrawal-declined">{`Withdrawal of ${formatMoney(last.amount_cents, last.currency)} declined: ${last.reason}`}</p></NewOnly>;
  }
  if (last?.status === "failed") {
    // What came back is stored on the withdrawal itself (back_cents), so the
    // line is said even when the page's figures did not load.
    const said = backSentence(last, back);
    return <NewOnly id={`${last.id}:failed`}><p className="live-stripe-error" role="alert" data-testid="withdrawal-failed">{`Withdrawal of ${formatMoney(last.amount_cents, last.currency)} did not go through.${said ? ` ${said}` : ""}`}</p></NewOnly>;
  }
  return null;
}

/**
 * What a failed withdrawal gave back (factory_balance().withdrawals back_cents):
 * all of it, part, or nothing when it went to the brand while being sent. The
 * same words as its notice (withdrawal_back_sentence).
 */
function backSentence(row, back) {
  // The figures' copy, else the withdrawal's own. Not kept (failed before it
  // was recorded): nothing said, never a guess.
  const stored = back instanceof Map && back.has(row.id) ? back.get(row.id) : row.back_cents;
  const cents = stored == null ? null : Number(stored);
  if (cents == null || !Number.isFinite(cents)) return null;
  if (cents >= Number(row.amount_cents)) return "The amount is back in your balance.";
  return cents > 0 ? `${formatMoney(cents, row.currency)} is back in your balance.` : NOTHING_BACK;
}

/**
 * A declined or failed withdrawal is said on the card while it is new: on the
 * page where this browser first shows it, not again in later visits (its row
 * in Transactions and the bell keep it). Browser storage only remembers what
 * was seen; without it the notice simply shows.
 */
function NewOnly({ id, children }) {
  const key = `tscWithdrawalNoticeSeen:${id}`;
  const [seenBefore] = useState(() => {
    try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, "1"); } catch { /* shown, nothing remembered */ }
  }, [key]);
  return seenBefore ? null : children;
}

export async function cancelWithdrawal(id) {
  const { error } = await supabase.rpc("cancel_withdrawal", { target_withdrawal: id });
  if (error) throw new Error(await cancelRefusal(error, [id]));
}

/** All or none: if one has started sending, none is cancelled. */
export async function cancelWithdrawals(ids) {
  const { error } = await supabase.rpc("cancel_withdrawals", { target_withdrawals: ids });
  if (error) throw new Error(await cancelRefusal(error, ids));
}

/**
 * The choice of which waiting withdrawals to cancel, in the payouts page's own
 * PayoutModal. `first` is ticked to start with (the row whose Cancel was pressed).
 */

// `onChanged`: read the balance again (a refusal means it moved meanwhile).
export function CancelWithdrawalsForm({ opens, first, Modal, onClose, onDone, onChanged, returnable = null }) {
  const waiting = opens.filter((w) => w.status === "requested");
  const [chosen, setChosen] = useState(() => new Set(first ? [first] : []));
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState(null);
  const ticked = waiting.filter((w) => chosen.has(w.id));
  // The server's figure for each, when it has one: the amount less what a refund took.
  const total = ticked.reduce((sum, w) => sum + (returnable instanceof Map && returnable.has(w.id) ? returnable.get(w.id) : Number(w.amount_cents)), 0);
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
      setError((await supabase.auth.getSession()).data?.session ? failure.message : SIGN_IN_ENDED);
      onChanged?.();
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
            {/* What it still holds (less a part refunded since), as the total below counts it. */}
            <span className="payout-pending-amount">{formatMoney(returnable instanceof Map && returnable.has(w.id) ? returnable.get(w.id) : w.amount_cents, w.currency)}</span>
            <span className="payout-pending-destination">{destination(w)}</span>
          </label>
        ))}
      </fieldset>
      {ticked.length ? <p className="cancel-withdrawals-total">{total > 0 ? `Back to your balance: ${formatMoney(total, "USD")}` : NOTHING_BACK}</p> : null}
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
// `others`: the factory's methods paid from another balance (its own Stripe
// banks), listed in the same "Withdraw to" so there is one Withdraw. Choosing
// one hands over to that balance's dialog (`onOther`), which shows what it can
// reach.
// `onRefused`: read the balance and the methods again after a refusal (they
// changed meanwhile, in another tab or by a teammate).
export function WithdrawForm({ orgId, available, methods, defaultId, onDone, onRefused, Modal, onClose, country = "", providers = null, others = [], onOther }) {
  // A saved method whose provider staff switched off stays saved: listed, not
  // chosen, and said in words, never silently missing.
  const choices = methods.filter((row) => usable(row) && methodProviderOn(providers, row));
  const switchedOff = methods.filter((row) => usable(row) && !methodProviderOn(providers, row));
  const [methodId, setMethodId] = useState((choices.find((m) => m.id === defaultId) ?? choices[0])?.id ?? "");
  const [amountText, setAmountText] = useState((available / 100).toFixed(2));
  // An amount is judged once the person works on it, never on opening: a
  // method whose balance is $0 says "Available: $0.00" and no error.
  const [amountTouched, setAmountTouched] = useState(false);
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
  // Read as typed, never changed under the person: more than available is said.
  const { cents: amountCents, problem: amountProblem } = parseWithdrawAmount(amountText, available, (cents) => formatMoney(cents, "USD"));
  const fee = amountProblem || !method ? null : withdrawalFee({ provider, amountCents, currency: "USD", country });
  // The provider's own figure when it can give one (Wise quotes per transfer);
  // otherwise the fee line, and the exact figure comes when TSC sends it.
  const exact = useExactQuote(orgId, method?.id, amountCents, Boolean(fee));
  const asking = Boolean(fee) && !exact;
  // What it costs and what arrives, before asking: the provider's own figure
  // when it gives one, else the published fee.
  const feeLine = amountProblem || !method ? null
    : exact && !exact.refused && exact.feeCents != null ? withdrawFeeLine(exact.feeCents, exact.receivesMinor, exact.receivesCurrency)
    : fee && !fee.refused && fee.feeCents != null ? withdrawFeeLine(fee.feeCents, fee.receivesCents, "USD") : null;


  async function confirm() {
    if (sending.current || busy || amountProblem || !method || !fee || fee.refused || exact?.refused) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const { error: refused } = await supabase.rpc("request_withdrawal", { target_org: orgId, amount: amountCents, target_account: method.id });
    sending.current = false;
    setBusy(false);
    // Signed out meanwhile (in another tab): say so, not "try again".
    if (refused && !(await supabase.auth.getSession()).data?.session) return setError(SIGN_IN_ENDED);
    if (refused) {
      setError(sentence(refused));
      onRefused?.();
      return undefined;
    }
    onDone();
  }

  const language = useUiLanguage();
  const label = (row) => withdrawOptionLabel(row, language);

  return (
    <Modal title="Withdraw" className="withdraw-form-modal" onClose={onClose} actions={<>
      <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary-btn" type="button" data-testid="withdraw-confirm" disabled={busy || Boolean(error) || asking || !method || Boolean(amountProblem) || !fee || Boolean(fee?.refused) || Boolean(exact?.refused)} onClick={confirm}>
        {busy ? "Withdrawing…" : Number.isFinite(amountCents) && amountCents > 0 ? `Withdraw ${formatMoney(amountCents, "USD")}` : "Withdraw"}
      </button>
    </>}>
      {/* Every saved method switched off by staff: nothing to choose, nothing to fill in. */}
      {!choices.length ? <>
        {switchedOff.map((row) => <p className="payout-modal-intro" data-testid="withdraw-method-off" key={row.id}>{label(row)}: {METHOD_OFF}</p>)}
        <p className="payout-modal-intro" data-testid="withdraw-no-method">Add another withdrawal method to withdraw.</p>
      </> : (
      <div className="withdraw-form-fields">
        <label className="payout-country-field withdraw-method-field">
          <span>Withdraw to</span>
          <select name="Withdraw to" value={methodId} disabled={busy} onChange={(event) => {
            const value = event.target.value;
            setError(null);
            if (value.startsWith("other:")) onOther?.(value.slice(6));
            else setMethodId(value);
          }}>
            {methodId ? null : <option value="" />}
            {choices.map((row) => <option key={row.id} value={row.id}>{label(row)}</option>)}
            {switchedOff.map((row) => <option key={row.id} value={row.id} disabled>{label(row)}</option>)}
            {others.map((other) => <option key={other.id} value={`other:${other.id}`}>{other.label}</option>)}
          </select>
        </label>
        {switchedOff.map((row) => <p className="withdraw-available" data-testid="withdraw-method-off" key={row.id}>{label(row)}: {METHOD_OFF_CHOOSE}</p>)}
        <div className="withdraw-amount-field payout-form-grid">
          <div className="withdraw-amount-heading">
            <label htmlFor="withdraw-amount">Amount (USD)</label>
            <button className="secondary-btn" type="button" disabled={busy} onClick={() => { setError(null); setAmountTouched(true); setAmountText((available / 100).toFixed(2)); }}>Withdraw full amount</button>
          </div>
          <input id="withdraw-amount" name="Amount (USD)" inputMode="decimal" value={amountText} disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              setError(null);
              setAmountTouched(true);
              setAmountText(value);
            }} aria-describedby="withdraw-available" />
          <p id="withdraw-available" className="withdraw-available">{`Available: ${formatMoney(available, "USD")}`}</p>
          {feeLine ? <p className="withdraw-available" data-testid="withdraw-fee">{feeLine}</p> : null}
        </div>
      </div>
      )}
      {/* One message: the server's refusal, when there is one, is the truth. */}
      {!error && choices.length > 0 && amountTouched && amountText && amountProblem ? <p className="live-stripe-error" role="alert">{amountProblem}</p> : null}
      {fee?.refused || exact?.refused ? <p className="live-stripe-error" role="alert">{fee?.refused ?? exact.refused}</p> : null}
      {error ? <p className="live-stripe-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
