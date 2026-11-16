/**
 * Why a payment to a factory did not go through, in one plain sentence per
 * failure code the providers give, and what the factory does next. Read by
 * the factory's payments row, its payout card and (through the server) the
 * bell. A code not listed here gets UNKNOWN_PAYOUT_FAILURE: never the
 * provider's own words, which are not written for the factory.
 *
 * - stripe: a withdrawal from the factory's balance to its bank
 *   (payout.failure_code). Stripe puts the money back in the balance.
 * - wise: a transfer TSC sent (the transfer's status).
 * - paypal: a payout item TSC sent (its transaction_status).
 *
 * The same map, Wise and PayPal only, is in the database's
 * payout_failure_sentence() (20261116500000), which writes the bell; the
 * Chinese is PAYOUT_WORDS_ZH in notification-zh.mjs. check:provider-payouts
 * fails if any of the three disagree.
 *
 * No imports, so api/ can load it with import().
 */
export const UNKNOWN_PAYOUT_FAILURE = "The payment did not go through. Check your payout details or contact TSC operations.";

export const PAYOUT_FAILURE_WORDS = {
  stripe: {
    account_closed: "Your bank account is closed. Add another bank account, then withdraw again.",
    account_frozen: "Your bank account is frozen. Ask your bank, or add another bank account, then withdraw again.",
    bank_account_restricted: "Your bank account cannot receive this payment. Ask your bank, or add another bank account, then withdraw again.",
    bank_ownership_changed: "Your bank account has a new owner. Add the bank account again, then withdraw again.",
    could_not_process: "Your bank could not process the payment. Withdraw again, or contact TSC operations.",
    debit_not_authorized: "Your bank refused the payment. Ask your bank to accept it, then withdraw again.",
    declined: "Your bank declined the payment. Ask your bank why, or add another bank account, then withdraw again.",
    incorrect_account_holder_address: "The account holder's address does not match your bank's records. Check it, then withdraw again.",
    incorrect_account_holder_name: "The account holder's name does not match your bank's records. Check it, then withdraw again.",
    incorrect_account_holder_tax_id: "The tax ID does not match your bank's records. Check it, then withdraw again.",
    insufficient_funds: "Your balance was too low when the withdrawal was sent. Withdraw again.",
    invalid_account_number: "The account number is wrong. Check your bank details, then withdraw again.",
    invalid_currency: "Your bank account cannot receive this currency. Add a bank account in your balance's currency, then withdraw again.",
    no_account: "Your bank has no account with these details. Check the account number, then withdraw again.",
    unsupported_card: "This debit card cannot receive withdrawals. Add a bank account, then withdraw again.",
  },
  wise: {
    bounced_back: "Your bank returned the payment. Check your bank details: TSC pays again once they are right.",
    funds_refunded: "The payment came back before it reached your bank. TSC will pay again or contact you.",
    charged_back: "The payment was reversed. TSC operations will contact you.",
  },
  paypal: {
    FAILED: "PayPal could not pay your PayPal account. Check your PayPal address: TSC pays again once it is right.",
    RETURNED: "PayPal returned the payment: nothing arrived. Check your PayPal address: TSC pays again once it is right.",
    BLOCKED: "PayPal blocked the payment. Check your PayPal account for limits, or contact TSC operations.",
    REFUNDED: "The payment was returned to TSC. TSC operations will contact you.",
    REVERSED: "The payment was reversed. TSC operations will contact you.",
  },
};

/** The sentence for one failure, or the plain one for a code we do not know. */
export function payoutFailureSentence(provider, code) {
  const words = PAYOUT_FAILURE_WORDS[provider];
  return (words && code && Object.hasOwn(words, code) ? words[code] : null) ?? UNKNOWN_PAYOUT_FAILURE;
}

/** "$1,234.56" or "EUR 1,234.56", as the database's format_money() writes it. */
export function payoutAmountWords(cents, currency) {
  const code = String(currency ?? "USD").toUpperCase();
  const figure = (Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return code === "USD" ? `$${figure}` : `${code} ${figure}`;
}
