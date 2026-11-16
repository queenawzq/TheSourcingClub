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
 *   stripe   TSC-managed accounts keep fees.payer = application (Stripe needs
 *            it on an account with no Stripe dashboard), so Stripe bills TSC
 *            "0.25% + 25¢ per payout sent", and "Cross-border payout fee:
 *            starting at 0.25% of payout volume" for an account outside TSC's
 *            country (the US). https://stripe.com/connect/pricing,
 *            https://docs.stripe.com/connect/cross-border-payouts. TSC holds
 *            that back: the transfer is the most that, with Stripe's payout
 *            fee on it, fits in the amount; the factory's fee is the rest.
 *            Stripe's US$2 per monthly active account is not charged to
 *            factories (out of scope). Charged per payment, not per payout:
 *            a payout carrying several payments is charged once by Stripe, so
 *            this never leaves TSC short.
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
 *            - anywhere else: 2% of the payout, at most US$100 (PayPal's
 *              "typically 2%"; the cap is the larger one PayPal publishes for
 *              international payouts, so TSC is never short). NOT yet seen in
 *              the sandbox: check the first international payout's fee.
 *            PayPal deducts it from TSC's balance on top of the item, so TSC
 *            sends the most that, with PayPal's fee on it, fits in the amount.
 *   bank     Staff pay it by bank wire ("Mark paid out by bank"), and TSC's bank
 *            charges TSC for the outgoing international wire. A fixed US$50:
 *            the highest common outgoing international wire fee of a US
 *            business bank (TO CONFIRM WITH JOHN: TSC's own bank's figure).
 *            Copied in public.bank_payout_fee_cents() (migration
 *            20261116100200); check:withdrawal-fees fails if they differ.
 *
 * Where a fee is uncertain, the HIGHEST published figure is charged, so TSC
 * is never short (decided 2026-11-16). Stripe's cross-border payout fee: the
 * Connect pricing page (https://stripe.com/connect/pricing, read 2026-11-16)
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
  stripe: { bps: 25, fixedCents: 25, crossBorderBps: 25, home: "US" },
  paypal: { domesticFixedCents: 25, bps: 200, internationalCapCents: 10000, home: "US" },
  bank: { fixedCents: 5000 },
};

/** ceil(amount × bps / 10000), in whole integers so no float decides a cent. */
const percentUp = (amountCents, bps) => Math.floor((amountCents * bps + 9999) / 10000);

/** What the provider bills TSC for sending x cents, rounded up. */
export function providerCharge(provider, country = "") {
  // An unknown country is charged as abroad: the larger fee, so TSC is never short.
  if (provider === "stripe") {
    const f = FEE_FORMULAS.stripe;
    const bps = f.bps + (country !== f.home ? f.crossBorderBps : 0);
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
    return {
      refused: `This payment of ${feeMoney(amount, currency)} is too small: the fee to send it is ${feeMoney(least, currency)}, so nothing would arrive. Nothing was sent.`,
      feeCents,
      basis,
    };
  }
  return { feeCents, receivesCents, basis };
}

/**
 * The sentence the factory reads on its payments row; the paid notification's
 * is the same words from public.payout_fee_sentence (migration 20261116100100).
 */
export function payoutFeeSentence(feeCents, receivesCents, currency = "USD") {
  const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  return `Payout fee ${money(feeCents)} is taken from this payment: you receive ${money(receivesCents)}.`;
}

/** The chooser's fee line, per route and language. */
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
      : "Fee: 2% (at most US$100) per payment, taken from it; PayPal may charge about 3–4% to convert US$"),
    zh: ({ us }) => (us
      ? "手续费：每笔 0.25 美元，从该笔款项中扣除"
      : "手续费：每笔 2%（最多 100 美元），从该笔款项中扣除；PayPal 换汇美元可能收取约 3–4%"),
  },
  bank: {
    en: () => "Fee: US$50 per payment for the bank transfer, taken from it; your bank may charge to receive it",
    zh: () => "手续费：每笔银行转账 50 美元，从该笔款项中扣除；你的银行可能收取入账费",
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
