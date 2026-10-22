/**
 * The brand's Payments page, on the designed `BillingScreen`.
 *
 * Payments: the brand's own order payments and where each stands (Not paid,
 * Payment processing, Failed, Funded, Paid; Sent only for an old bank-wire
 * claim) with the design's four figures (brand-payments-view.js). A row opens
 * its transaction page; a due one opens the Fund screen on its order for an
 * owner, who alone may pay (begin_payment_checkout). A member's due row opens
 * the transaction page, which says so up front.
 * Discounts: the brand's real credit and discount codes (credits.js), the
 * same ones the dashboard's Savings card shows. Nothing redeems a code at
 * payment yet, so the design's "Use an unused code at payment" is not said.
 *
 * Cards are entered only in Stripe's own form on the Fund screen, and nothing
 * is saved here, so the design's saved cards and invoices are left out.
 */
import React, { useEffect, useMemo, useState } from "react";
import { BillingScreen } from "../../prototype/main.jsx";
import { listOrders } from "../../lib/domain/order.js";
import { listPaymentsForOrders } from "../../lib/domain/payment.js";
import { listDiscountCodes, savingsFor } from "../../lib/domain/credits.js";
import { useRouter } from "../../lib/router.jsx";
import { ALL_VENDORS, brandPaymentsView } from "./brand-payments-view.js";
import "../browse/browse.css";
import "../order/payout.css";

export default function LiveBrandPayments({ org }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ loaded: null, codes: [], savings: null, error: null });
  const [copied, setCopied] = useState(null);
  // BillingScreen keeps its vendor filter to itself and applies it to the
  // rows only; the live mount hears the same change and recomputes the four
  // figures from that vendor's payments, as the factory's page does.
  const [vendor, setVendor] = useState(ALL_VENDORS);
  const view = useMemo(() => (state.loaded ? brandPaymentsView({ ...state.loaded, vendor }) : null), [state.loaded, vendor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only the orders this brand placed: a person in both a brand and a
      // factory org gets the active org's side.
      const orders = (await listOrders(org.id)).filter((order) => order.brand_org_id === org.id);
      const [payments, codes, savings] = await Promise.all([
        listPaymentsForOrders(orders.map((order) => order.id)),
        listDiscountCodes(org.id),
        savingsFor(org.id),
      ]);
      return { loaded: { orders, payments }, codes, savings };
    })().then(
      (loaded) => !cancelled && setState({ ...loaded, error: null }),
      (error) => !cancelled && setState({ loaded: null, codes: [], savings: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id]);

  if (state.error) {
    return <main className="billing-page-shell"><p className="live-profile-error" role="alert">Couldn't load your payments: {state.error.message}</p></main>;
  }
  if (!view) {
    return <main className="billing-page-shell"><p className="live-profile-loading">Loading your payments…</p></main>;
  }

  const copy = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
    } catch {
      // A browser that refuses the clipboard: the code is on screen to copy by hand.
      setCopied(null);
    }
  };

  return (
    <main
      className="billing-page-shell"
      onChange={(event) => {
        if (event.target.matches?.(".billing-controls select")) setVendor(event.target.value);
      }}
    >
      <BillingScreen
        accountType="brand"
        live={{
          metrics: view.metrics,
          rows: view.rows.map((row) => {
            // A due payment has no transaction to show yet: it opens the Fund
            // screen, for an owner. A member cannot pay, so its row opens the
            // transaction page, which says who can.
            const path = row.state === "due" && org.role === "owner"
              ? `/orders/${row.orderId}/payments/${row.id}`
              : `/payments/${row.orderId}/${row.id}`;
            return { ...row, href: `/app.html${path}`, onOpen: () => navigate(path) };
          }),
          empty: "No payment transactions yet.",
          discount: state.savings ? { amount: state.savings.amount, note: state.savings.note } : null,
          codes: state.codes,
          codesNote: "Codes can't be applied to a payment yet. Used codes stay here so finance can track order discounts.",
          onCopy: copy,
          copied,
        }}
      />
    </main>
  );
}
