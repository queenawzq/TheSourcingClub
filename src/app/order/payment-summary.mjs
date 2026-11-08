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
export const heldOnCancelledOrder = (row) => row.state === "confirmed" && !row.release_requested_at && row.order?.status === "cancelled";

/**
 * Whether Stripe's answer changes this factory's figures: only once TSC has
 * paid one of its earnings through Stripe. A bank-paid factory, or one paid
 * nothing through Stripe yet, never waits for it.
 */
export const stripeRelevant = (earnings) => Boolean(earnings?.some((row) => row.state === "released" && row.stripe_transfer_id));

/**
 * Paid by hand (Payoneer, bank, or no method yet): no Stripe account that can
 * take transfers, and nothing paid through Stripe so far. The factory's money
 * is then wherever its payments say, and Stripe has nothing to add.
 */
export const isHandPaid = (account, earnings) => !account?.transfers_active && !stripeRelevant(earnings);

/**
 * The card's two figures for a factory paid by hand, across all clients.
 * Balance is approved and not sent yet; pending is waiting for the brand.
 * Null until the earnings answer.
 */
export function handPaidFigures(earnings) {
  if (!earnings) return { balance: null, pending: null };
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  return { balance: amounts(earnings.filter(toBeSent)), pending: amounts(earnings.filter(awaitingApproval)) };
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
 * Where one earning stands, in the factory's words. Released through Stripe
 * is in the balance only once Stripe has processed it; released by bank or
 * Payoneer went to that account, never to a balance.
 *
 * `balance` is Stripe's answer: undefined while it is still being read (the
 * list draws before it arrives, and said "Credited to balance" for two
 * seconds before "Pending"), null when it cannot be read (not an owner,
 * Stripe unreachable), when only "sent to Stripe" is known to be true.
 *
 * `handPaid`: approved money is not processing anywhere; TSC has to send it.
 */
export function earningStatus(row, balance, handPaid = false) {
  if (heldOnCancelledOrder(row)) return "Order cancelled";
  if (row.state !== "released") return row.release_requested_at ? (handPaid ? "To be sent" : "Pending") : "Awaiting approval";
  if (row.payoneer_payouts) return "Paid by Payoneer";
  if (!row.stripe_transfer_id) return "Paid by bank transfer";
  if (balance === undefined) return "Checking…";
  if (balance === null) return "Sent to your Stripe account";
  return balance.pendingEarnings?.some((pending) => pending.paymentId === row.id) ? "Pending" : "Credited to balance";
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
