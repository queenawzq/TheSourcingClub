export const factoryAmount = (row) => row.charged_cents ? row.amount_cents : row.amount_received_cents ?? row.amount_cents;

/** Keep currencies separate: a converted bank withdrawal is not a USD total. */
export function currencyTotals(rows) {
  const totals = new Map();
  for (const { amount, currency } of rows) {
    const code = currency.toUpperCase();
    totals.set(code, (totals.get(code) || 0) + Number(amount));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

/**
 * Where money with TSC stands, by the same rules as the staff board's buckets
 * (AdminPayments, `check:earnings`). Held on a cancelled order is on its way
 * back to the brand, so it is nobody's earnings; approved before the
 * cancellation is still owed.
 */
export const awaitingApproval = (row) => row.state === "confirmed" && !row.release_requested_at && row.order?.status !== "cancelled";
export const toBeSent = (row) => row.state === "confirmed" && Boolean(row.release_requested_at);
/** Provider attempts, as the embed gives them: a list, or nothing for a brand. */
const attempts = (row) => row.provider_payouts ?? [];
/** A payment Wise or PayPal is sending now. Still owed until it is paid. */
export const onItsWay = (row) => toBeSent(row) && attempts(row).some((attempt) => attempt.status === "processing");
export const heldOnCancelledOrder = (row) => row.state === "confirmed" && !row.release_requested_at && row.order?.status === "cancelled";

/**
 * Whether Stripe's answer changes this factory's figures: only once TSC has
 * paid one of its earnings through Stripe. A bank-paid factory, or one paid
 * nothing through Stripe yet, never waits for it.
 */
export const stripeRelevant = (earnings) => Boolean(earnings?.some((row) => row.state === "released" && row.stripe_transfer_id));

/**
 * Not paid through Stripe (Wise, PayPal, by hand, or no method yet): no Stripe account that can
 * take transfers, and nothing paid through Stripe so far. The factory's money
 * is then wherever its payments say, and Stripe has nothing to add.
 */
export const isHandPaid = (account, earnings) => !account?.transfers_active && !stripeRelevant(earnings);

/**
 * The card's figures for a factory paid by hand, across all clients. Balance is
 * approved and nobody is sending it yet; on its way is being sent; pending is
 * waiting for the brand. Balance + on its way is the strip's Pending.
 * Null until the earnings answer.
 */
export function handPaidFigures(earnings) {
  if (!earnings) return { balance: null, onItsWay: null, pending: null };
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  return {
    balance: amounts(earnings.filter((row) => toBeSent(row) && !onItsWay(row))),
    onItsWay: amounts(earnings.filter(onItsWay)),
    pending: amounts(earnings.filter(awaitingApproval)),
  };
}

/**
 * The four figures over the Transactions list. Each is a list of amounts by
 * currency when known, undefined while a source it needs has not answered
 * (the page draws a placeholder), and null when it cannot be known (Stripe
 * failed, or only an owner may read the balance). Never a partial figure:
 * Pending and Paid out computed before Stripe answered showed one amount,
 * then jumped to another.
 */
export function earningsSummaryFor(earnings, balance, client) {
  if (!earnings) return { total: undefined, approval: undefined, pending: undefined, paid: undefined };
  const all = client === "All clients";
  const byId = new Map(earnings.map((row) => [row.id, row]));
  const selected = (row) => all || row?.order?.brand_org_id === client;
  const funded = earnings.filter((row) => ["confirmed", "released"].includes(row.state) && !heldOnCancelledOrder(row) && selected(row));
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  const pendingIds = new Set(balance?.pendingEarnings?.map((row) => row.paymentId));
  // Paid out with no Stripe transfer: TSC sent it by bank (where Stripe cannot
  // pay out), whether the brand paid by card or by an old bank wire.
  const bankPaid = earnings.filter((row) => row.state === "released" && !row.stripe_transfer_id && selected(row));
  const paid = balance?.payouts?.filter((row) => row.paid) || [];
  const paidAmounts = paid.flatMap((row) => all
    ? [{ amount: row.amount, currency: row.currency }]
    : row.allocations.filter((part) => selected(byId.get(part.paymentId)))
      .map((part) => ({ amount: part.amount, currency: row.currency })));
  // Whether Stripe matters is the account's question, whichever client is selected.
  const stripeFigure = (figure) => (!stripeRelevant(earnings) || balance ? figure() : balance);
  return {
    total: amounts(funded),
    approval: amounts(funded.filter(awaitingApproval)),
    pending: stripeFigure(() => amounts(funded.filter((row) => toBeSent(row) || pendingIds.has(row.id)))),
    paid: stripeFigure(() => currencyTotals([
      ...paidAmounts, ...bankPaid.map((row) => ({ amount: factoryAmount(row), currency: row.currency })),
    ])),
  };
}

/**
 * Where one earning stands, in one set of words: Awaiting approval, Pending,
 * Paid. How it was sent is on its withdrawal row. Released through Stripe is in
 * the balance only once Stripe has processed it.
 *
 * `balance` is Stripe's answer: undefined while it is still being read (the
 * list draws before it arrives, and said "Paid" for two seconds before
 * "Pending"), null when it cannot be read (not an owner, Stripe unreachable).
 */
export function earningStatus(row, balance) {
  if (heldOnCancelledOrder(row)) return "Order cancelled";
  if (row.state !== "released") return row.release_requested_at ? "Pending" : "Awaiting approval";
  if (!row.stripe_transfer_id) return "Paid";
  if (balance === undefined) return "Pending";
  if (balance === null) return "Paid";
  return balance.pendingEarnings?.some((pending) => pending.paymentId === row.id) ? "Pending" : "Paid";
}

const WITHDRAWAL_STATUS = { processing: "Processing", paid: "Completed", failed: "Failed" };
const FAILURE_NOTE = {
  details_rejected: { wise: "Check your bank details", paypal: "Check your PayPal email" },
};

/** What a failed attempt asks of this person, or nothing they can do. */
export const failureNote = (attempt) => FAILURE_NOTE[attempt.failure_code]?.[attempt.provider] ?? "TSC will try again";

const when = (row) => row.released_at || row.confirmed_at || row.created_at;

/**
 * A payment sent by anything but Stripe, as rows of its own: one per Wise or
 * PayPal attempt, or one for what staff marked paid by hand. Stripe's own
 * withdrawals come from Stripe. Only "Failed" keeps its amount unsigned: that
 * money never left.
 */
export function withdrawalRows(earnings) {
  return (earnings ?? []).flatMap((row) => {
    const owner = { brandOrgId: row.order?.brand_org_id, currency: row.currency };
    const tried = attempts(row).map((attempt) => ({
      ...owner,
      id: `provider-${attempt.id}`,
      date: attempt.paid_at || attempt.created_at,
      title: attempt.provider === "paypal" ? "PayPal" : "Bank transfer",
      meta: attempt.paid_to,
      note: attempt.status === "failed" ? failureNote(attempt) : null,
      status: WITHDRAWAL_STATUS[attempt.status],
      failed: attempt.status === "failed",
      amount: attempt.status === "failed" ? Number(attempt.amount_cents) : -Number(attempt.amount_cents),
    }));
    if (row.state !== "released" || row.stripe_transfer_id || attempts(row).some((attempt) => attempt.status === "paid")) return tried;
    const bank = row.bank_payouts;
    const payoneer = row.payoneer_payouts;
    return [...tried, {
      ...owner,
      id: `sent-${row.id}`,
      date: when(row),
      title: payoneer ? "Payoneer" : "Bank transfer",
      meta: payoneer ? payoneer.paid_to_email
        : bank?.paid_to_bank ? `${bank.paid_to_bank}${bank.paid_to_last4 ? ` ····${bank.paid_to_last4}` : ""}` : "",
      note: payoneer ? `Reference ${payoneer.payoneer_payment_id}` : staffBankNote(row) ? `Reference ${staffBankNote(row)}` : null,
      status: "Completed",
      failed: false,
      amount: -factoryAmount(row),
    }];
  });
}

/** The newest attempt on a payment still owed, if it failed: what the page must raise. */
export function failedWithdrawal(earnings) {
  return (earnings ?? []).filter(toBeSent).map((row) => [...attempts(row)].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0])
    .find((attempt) => attempt?.status === "failed") ?? null;
}

/**
 * What staff typed when they marked this paid by bank, for the factory to find
 * the transfer by. A person's note only: Stripe's own payouts write a sentence
 * of their own into the same column, with nobody in released_by.
 */
export function staffBankNote(row) {
  if (row.state !== "released" || row.stripe_transfer_id || row.payoneer_payouts || !row.released_by) return null;
  return row.released_note?.trim() || null;
}

/** When Stripe makes an earning still pending withdrawable: its day, read as a day. */
export function availableOn(row, balance) {
  const day = balance?.pendingEarnings?.find((pending) => pending.paymentId === row.id)?.available_on;
  return day ? new Date(day * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
}
