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
/**
 * Money that has left TSC and is moving. A Wise transfer nobody has funded has
 * not left, and PayPal holding a payment for an address with no account is not
 * moving: both are still the factory's balance.
 */
const moving = (attempt) => attempt.status === "processing" && Boolean(attempt.money_left_at) && !attempt.details_asked_at;
export const onItsWay = (row) => toBeSent(row) && attempts(row).some(moving);
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
 * approved and not moving yet; on its way has left TSC; pending is waiting for
 * the brand. Balance + on its way is the strip's Pending.
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
 * The four figures over the Transactions list: each earning in exactly one of
 * Awaiting approval, Pending and Paid out, by the word on its own row, so they
 * add up to Total earnings for whoever reads them. All from the payments, in the
 * orders' currency, never from Stripe: what a factory later moved from its
 * Stripe balance to its bank is a withdrawal, not a second kind of paid. Each is
 * undefined until the earnings answer.
 */
export function earningsSummaryFor(earnings, client) {
  if (!earnings) return { total: undefined, approval: undefined, pending: undefined, paid: undefined };
  const all = client === "All clients";
  const selected = (row) => all || row?.order?.brand_org_id === client;
  const funded = earnings.filter((row) => ["confirmed", "released"].includes(row.state) && !heldOnCancelledOrder(row) && selected(row));
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  return {
    total: amounts(funded),
    approval: amounts(funded.filter(awaitingApproval)),
    pending: amounts(funded.filter(toBeSent)),
    paid: amounts(funded.filter((row) => row.state === "released")),
  };
}

/**
 * Where one earning stands: Awaiting approval, Pending, Paid. The one word for
 * this money, on Payments and the factory's order page, whoever reads it: it
 * comes from the payment alone, never from Stripe's answer, which only an owner
 * can read. Money Stripe is still clearing is Paid here and on the strip; the
 * card says when it can be withdrawn. How it was sent is on its withdrawal row.
 */
export function earningStatus(row) {
  if (heldOnCancelledOrder(row)) return "Order cancelled";
  if (row.state === "released") return "Paid";
  return row.release_requested_at ? "Pending" : "Awaiting approval";
}

const WITHDRAWAL_STATUS = { processing: "Processing", paid: "Completed", failed: "Failed" };
const FAILURE_NOTE = {
  details_rejected: { wise: "Check your bank details", paypal: "Check your PayPal address" },
};

/** Sent, but the provider is holding it until the factory corrects its details. */
export const waitingOnDetails = (attempt) => attempt.status === "processing" && Boolean(attempt.details_asked_at);
const askFor = (attempt) => FAILURE_NOTE.details_rejected[attempt.provider];

/** What a failed attempt asks of this person, or nothing they can do. */
export const failureNote = (attempt) => attempt.asked_to_check ?? FAILURE_NOTE[attempt.failure_code]?.[attempt.provider] ?? "TSC will try again";

/**
 * PayPal holds this payment for the address it was sent to, and the factory has
 * since moved on from that address: the money does not follow it. Asking again
 * would be wrong, and so would saying it is on its way. Staff take it back and
 * pay again (the board says so).
 */
const sentToOldAddress = (attempt, method) => waitingOnDetails(attempt) && Boolean(method)
  && (method.paypal_email ?? "").toLowerCase() !== (attempt.paid_to ?? "").toLowerCase();
const WILL_RESEND = "TSC will send it again";

/** A failure that asked for a correction, and the details have changed since. */
const detailsChangedSince = (attempt, method) => (Boolean(attempt.asked_to_check) || attempt.failure_code === "details_rejected")
  && Boolean(method?.details_changed_at) && new Date(method.details_changed_at) > new Date(attempt.updated_at ?? attempt.created_at);

const when = (row) => row.released_at || row.confirmed_at || row.created_at;

/**
 * A payment sent by anything but Stripe, as rows of its own: one per Wise or
 * PayPal attempt, or one for what staff marked paid by hand. Stripe's own
 * withdrawals come from Stripe. A failed one is drawn struck through: that money
 * never left. An attempt that has not left TSC yet is no withdrawal: that money
 * is on the row of its earning, and staff may still take it back.
 */
export function withdrawalRows(earnings, method = null) {
  return (earnings ?? []).flatMap((row) => {
    const owner = { brandOrgId: row.order?.brand_org_id, currency: row.currency };
    const tried = attempts(row).filter((attempt) => attempt.status !== "processing" || attempt.money_left_at).map((attempt) => ({
      ...owner,
      id: `provider-${attempt.id}`,
      date: attempt.paid_at || attempt.created_at,
      title: attempt.provider === "paypal" ? "PayPal" : "Bank transfer",
      meta: attempt.paid_to,
      note: attempt.status === "failed" ? (detailsChangedSince(attempt, method) ? null : failureNote(attempt)) : sentToOldAddress(attempt, method) ? WILL_RESEND : waitingOnDetails(attempt) ? askFor(attempt) : null,
      status: waitingOnDetails(attempt) ? "Waiting" : WITHDRAWAL_STATUS[attempt.status],
      failed: attempt.status === "failed",
      amount: -Number(attempt.amount_cents),
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
        : bank?.paid_to_bank ? `${bank.paid_to_bank}${bank.paid_to_last4 ? ` ending ${bank.paid_to_last4}` : ""}` : "",
      note: payoneer ? `Reference ${payoneer.payoneer_payment_id}` : staffBankNote(row) ? `Reference ${staffBankNote(row)}` : null,
      status: "Completed",
      failed: false,
      amount: -factoryAmount(row),
    }];
  });
}

/**
 * What the card must raise, in the bell's words: the newest attempt on a payment
 * still owed, if it failed or is waiting on the factory's details. A failed one
 * stops asking once the details change; nothing was sent, so nothing is left to
 * say. A waiting one still has the money at the old address.
 */
export function withdrawalProblem(earnings, method) {
  const attempt = (earnings ?? []).filter(toBeSent)
    .map((row) => [...attempts(row)].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0])
    .find((latest) => latest?.status === "failed" || (latest && waitingOnDetails(latest)));
  if (!attempt) return null;
  const amount = (Number(attempt.amount_cents) / 100).toLocaleString("en-US", { style: "currency", currency: attempt.currency ?? "USD" });
  if (sentToOldAddress(attempt, method)) return { fixable: false, line: `Your payment of ${amount} is waiting. ${WILL_RESEND}.` };
  if (waitingOnDetails(attempt)) return { fixable: true, line: `Your payment of ${amount} is waiting. ${askFor(attempt)}.` };
  if (detailsChangedSince(attempt, method)) return null;
  const fixable = Boolean(attempt.asked_to_check) || attempt.failure_code === "details_rejected";
  return { fixable, line: `A withdrawal failed. ${failureNote(attempt)}.` };
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
