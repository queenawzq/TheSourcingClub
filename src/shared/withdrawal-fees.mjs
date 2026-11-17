/**
 * What a withdrawal costs the factory: the one source of the fee for the
 * chooser, the server that pays, the staff board, the payments row and the
 * notification. Pure, so both api/ and the browser import it.
 *
 * TSC pays no payout or withdrawal fee: the provider's fee comes out of the
 * amount, so TSC's balance goes down by exactly the amount and the factory
 * receives amount − fee. Every fee is rounded UP to the cent, so TSC is never
 * short by a rounding.
 *
 * Figures, checked 2026-11-16:
 *
 *   stripe   Checked 2026-11-17 on https://stripe.com/connect/pricing ("You
 *            handle pricing"). TSC-managed accounts keep fees.payer =
 *            application (Stripe needs it on an account with no Stripe
 *            dashboard), so Stripe bills TSC, monthly, for each payout a
 *            factory makes to its bank: "0.25% + 25¢ per payout", the
 *            cross-border payout fee "starting at 0.25% of payout volume" for
 *            an account outside TSC's country (the US;
 *            https://docs.stripe.com/connect/cross-border-payouts), and funds
 *            routing at "0.25% of payout volume". Stripe's page does not limit
 *            funds routing to any country, so it is charged on EVERY payout,
 *            US included: 0.50% + 25¢ in the US, 0.75% + 25¢ elsewhere.
 *            Nothing is billed per transfer, so an approved step reaches the
 *            factory's Stripe balance in full, and the fee is taken once per
 *            withdrawal (api/_stripe-withdrawals.js: a partial reversal of the
 *            factory's transfers, then the payout of the rest). TSC keeps
 *            paying Stripe's US$2 per monthly active account: it is not
 *            charged to factories.
 *   wise     Wise's fee depends on the route and the recipient, so it is the
 *            quote's (api/_wise.js quote(), asked with the amount as the
 *            source: the fee is inside it). https://wise.com/pricing/business
 *   tazapay  The quote's fee, as for Wise (about US$5.44 to China in the
 *            sandbox).
 *   paypal   "The sender pays payout fees", capped per currency, domestic and
 *            international differ (https://developer.paypal.com/payouts/fees).
 *            PayPal's own fee pages refuse automated reading, so the figures
 *            are what PayPal charged in its sandbox, on 2026-11-16:
 *            - to a US account (domestic for TSC): US$0.25 per payout made
 *              through the Payouts API (the sandbox's payout_item_fee on a
 *              US$98.03 payout was 0.25; a published table of PayPal's US fees
 *              lists "When using the Payouts API $0.25").
 *            - anywhere else: 2% of the payout, at most US$20 (PayPal Payouts,
 *              international, on paypal.com/us/business/paypal-business-fees,
 *              updated Nov 4, 2026). NOT yet seen in the sandbox: check the
 *              first international payout's fee.
 *            PayPal deducts it from TSC's balance on top of the item, so TSC
 *            sends the most that, with PayPal's fee on it, fits in the amount.
 *   bank     Not a withdrawal method: a factory can no longer withdraw to a bank
 *            staff pay by hand (20261117500000). It is the fee of the staff
 *            fallback on the per-step board ("Mark paid out by bank", for a Wise
 *            bank account or a factory Stripe cannot pay), and of a bank
 *            withdrawal asked for before that change. Staff pay it by bank
 *            wire, and TSC's bank charges TSC for the outgoing international
 *            wire. A fixed US$50:
 *            the highest common outgoing international wire fee of a US
 *            business bank (TO CONFIRM WITH JOHN: TSC's own bank's figure).
 *            Copied in public.bank_payout_fee_cents() (migration
 *            20261116100200); check:withdrawal-fees fails if they differ.
 *
 * Where a fee is uncertain, the HIGHEST published figure is charged, so TSC
 * is never short (decided 2026-11-16). Stripe's cross-border payout fee: the
 * Connect pricing page (https://stripe.com/connect/pricing, read 2026-11-17)
 * gives only "Starting at 0.25% of payout volume", with no per-country table,
 * no range and no higher figure, and its linked page
 * (https://docs.stripe.com/connect/cross-border-payouts) gives no other; so
 * 0.25% is the highest Stripe publishes. Recheck it against the first
 * monthly Connect invoice. Stripe's US$2 per monthly active account is not
 * charged to factories (decided 2026-11-16).
 *
 * withdrawalFee() never decides alone where a provider gives a figure: a
 * quoted fee (quotedFeeCents) always wins over the formula.
 */

const PROVIDERS = new Set(["stripe", "wise", "paypal", "tazapay", "bank"]);
const QUOTED = new Set(["wise", "tazapay"]);

/** The published formulas, in basis points and cents. */
export const FEE_FORMULAS = {
  // Per payout: 0.25% + 25¢, funds routing 0.25% everywhere, cross-border 0.25% outside the US.
  stripe: { bps: 25, fixedCents: 25, fundsRoutingBps: 25, crossBorderBps: 25, home: "US" },
  paypal: { domesticFixedCents: 25, bps: 200, internationalCapCents: 2000, home: "US" },
  bank: { fixedCents: 5000 },
};

/** ceil(amount × bps / 10000), in whole integers so no float decides a cent. */
const percentUp = (amountCents, bps) => Math.floor((amountCents * bps + 9999) / 10000);

/** What the provider bills TSC for sending x cents, rounded up. */
export function providerCharge(provider, country = "") {
  // An unknown country is charged as abroad: the larger fee, so TSC is never short.
  if (provider === "stripe") {
    const f = FEE_FORMULAS.stripe;
    const bps = f.bps + f.fundsRoutingBps + (country !== f.home ? f.crossBorderBps : 0);
    return (x) => percentUp(x, bps) + f.fixedCents;
  }
  if (provider === "bank") return () => FEE_FORMULAS.bank.fixedCents;
  const f = FEE_FORMULAS.paypal;
  if (country === f.home) return () => f.domesticFixedCents;
  return (x) => Math.min(percentUp(x, f.bps), f.internationalCapCents);
}

/** The largest x with x + charge(x) <= amount (charge is non-decreasing), or 0. */
function largestSend(amount, charge) {
  let lo = 0;
  let hi = amount;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (mid + charge(mid) <= amount) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const symbol = (currency) => (currency === "USD" ? "US$" : `${currency} `);
export const feeMoney = (cents, currency = "USD") => {
  const value = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}${symbol(currency)}${value}`;
};

/**
 * withdrawalFee({ provider, amountCents, currency, country, quotedFeeCents })
 *   → { feeCents, receivesCents, basis }
 *   → { refused: "<sentence>" } when nothing would arrive.
 *
 * basis: "quote" (the provider's own figure), "formula" (published, or the bank wire's fixed fee)
 * or "quote_needed" (Wise/Tazapay with no quote yet:
 * feeCents and receivesCents are null, and nothing may be sent on it).
 */
export function withdrawalFee({ provider, amountCents, currency = "USD", country = "", quotedFeeCents = null } = {}) {
  if (!PROVIDERS.has(provider)) throw new Error(`Unknown payout provider: ${provider}`);
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { refused: "There is nothing to send: the amount must be more than zero." };

  let feeCents;
  let basis;
  if (quotedFeeCents != null && Number.isFinite(Number(quotedFeeCents))) {
    feeCents = Math.ceil(Number(quotedFeeCents));
    basis = "quote";
  } else if (QUOTED.has(provider)) {
    return { feeCents: null, receivesCents: null, basis: "quote_needed" };
  } else {
    // The provider bills TSC its fee on what is SENT, on top of it. So send the
    // most that, with its own fee, still fits in the amount; the factory's fee
    // is the rest. TSC's balance then goes down by the amount (at most a cent
    // less where the provider's rounding favours TSC), never more.
    const charge = providerCharge(provider, country);
    feeCents = amount - largestSend(amount, charge);
    basis = "formula";
  }

  const receivesCents = amount - feeCents;
  if (receivesCents <= 0) {
    // The smallest fee the provider would take, not the whole amount.
    const least = basis === "formula" ? providerCharge(provider, country)(1) : feeCents;
    return { refused: tooSmallSentence(amount, least, currency), feeCents, basis };
  }
  return { feeCents, receivesCents, basis };
}

const tooSmallSentence = (amount, least, currency) =>
  `This payment of ${feeMoney(amount, currency)} is too small: the fee to send it is ${feeMoney(least, currency)}, so nothing would arrive. Nothing was sent.`;

/**
 * A withdrawal from a factory's Stripe balance: the fee TSC takes back (in
 * US$, by reversing part of the factory's US$ transfers) for Stripe's bill on
 * the payout. The balance may be in the account's own currency (GBP, EUR…):
 * `localPerUsd` is how much of it one US$ bought on the factory's latest
 * transfer (Stripe's exchange_rate), 1 for a US$ balance. Stripe bills on the
 * payout converted to US$, so the formula runs on the amount in US$; the
 * largest-send rule makes the fee cover Stripe's charge on what is paid out.
 *
 *   → { feeCents (US$), usdCents, feeLocalEstimate (balance currency, before Stripe converts) }
 *   → { refused: "<sentence>" } (in the balance's currency) when nothing would arrive.
 */
export function stripeWithdrawalFee({ amountMinor, currency = "USD", country = "", localPerUsd = 1 } = {}) {
  const amount = Number(amountMinor);
  const rate = Number(localPerUsd);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { refused: "There is nothing to send: the amount must be more than zero." };
  if (!(rate > 0)) throw new Error("A positive exchange rate is needed");
  const code = String(currency).toUpperCase();
  // Rounded up: a larger US$ figure gives the larger fee, so TSC is never short.
  const usdCents = code === "USD" ? amount : Math.ceil(amount / rate);
  const fee = withdrawalFee({ provider: "stripe", amountCents: usdCents, currency: "USD", country });
  const inLocal = (usd) => (code === "USD" ? usd : Math.ceil(usd * rate));
  // In the balance's own currency too: a converted fee can use up a tiny amount.
  if (fee.refused || amount - inLocal(fee.feeCents) <= 0) {
    return { refused: tooSmallSentence(amount, inLocal(providerCharge("stripe", country)(1)), code) };
  }
  return { feeCents: fee.feeCents, usdCents, feeLocalEstimate: inLocal(fee.feeCents) };
}

/**
 * The sentence the factory reads on its payments row; the paid notification's
 * is the same words from public.payout_fee_sentence (migration 20261116100100).
 */
export function payoutFeeSentence(feeCents, receivesCents, currency = "USD") {
  const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  return `Payout fee ${money(feeCents)} is taken from this payment: you receive ${money(receivesCents)}.`;
}

/** The chooser's fee line, per route and language. No bank line: TSC no longer pays a bank by hand. */
const LINES = {
  stripe: {
    en: ({ us }) => (us
      ? "Fee: 0.25% + US$0.25 per payment, taken from it"
      : "Fee: 0.5% + US$0.25 per payment, taken from it; Stripe converts from US$ at its rate"),
    zh: ({ us }) => (us
      ? "手续费：每笔 0.25% + 0.25 美元，从该笔款项中扣除"
      : "手续费：每笔 0.5% + 0.25 美元，从该笔款项中扣除；Stripe 按其汇率将美元换成你的币种"),
  },
  wise: {
    en: ({ us }) => (us
      ? "Fee: Wise's fee, quoted for each payment and taken from it"
      : "Fee: Wise's fee, quoted for each payment and taken from it, at the mid-market rate"),
    zh: ({ us }) => (us
      ? "手续费：Wise 费用，每笔单独报价，从该笔款项中扣除"
      : "手续费：Wise 费用，每笔单独报价，从该笔款项中扣除，按中间市场汇率"),
  },
  tazapay: {
    en: () => "Fee: Tazapay's fee, quoted for each payment and taken from it",
    zh: () => "手续费：Tazapay 费用，每笔单独报价，从该笔款项中扣除",
  },
  paypal: {
    en: ({ us }) => (us
      ? "Fee: US$0.25 per payment, taken from it"
      : "Fee: 2% (at most US$20) per payment, taken from it; PayPal may charge about 3–4% to convert US$"),
    zh: ({ us }) => (us
      ? "手续费：每笔 0.25 美元，从该笔款项中扣除"
      : "手续费：每笔 2%（最多 20 美元），从该笔款项中扣除；PayPal 换汇美元可能收取约 3–4%"),
  },
};

export function withdrawalFeeLine(provider, { country = "", language = "en" } = {}) {
  const line = LINES[provider];
  if (!line) throw new Error(`Unknown payout provider: ${provider}`);
  return (line[language] ?? line.en)({ us: country === "US" });
}

/** Every chooser fee line, English to Chinese, for the factory's dictionary. */
export const WITHDRAWAL_FEE_LINES_ZH = Object.fromEntries(
  Object.keys(LINES).flatMap((provider) => ["US", ""].map((country) => [
    withdrawalFeeLine(provider, { country }),
    withdrawalFeeLine(provider, { country, language: "zh" }),
  ])),
);
