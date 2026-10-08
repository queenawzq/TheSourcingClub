/**
 * The brand's Payments page, on the designed `BillingScreen`.
 *
 * Payments: the brand's own order payments and where each stands (Due, Sent,
 * Funded, Paid) with the design's four figures (brand-payments-view.js). A row
 * opens that payment's page on its order, where a due payment is marked sent.
 * Discounts: the brand's real credit and discount codes (credits.js), the
 * same ones the dashboard's Savings card shows.
 *
 * Nothing here takes a card or a bank number: payments are track-only, and
 * the design's saved cards, invoices and platform fee rows have nothing
 * behind them, so they are left out.
 */
import React, { useEffect, useState } from "react";
import { BillingScreen } from "../../prototype/main.jsx";
import { listOrders } from "../../lib/domain/order.js";
import { listPaymentsForOrders } from "../../lib/domain/payment.js";
import { listDiscountCodes, savingsFor } from "../../lib/domain/credits.js";
import { useRouter } from "../../lib/router.jsx";
import { brandPaymentsView } from "./brand-payments-view.js";
import "../browse/browse.css";

export default function LiveBrandPayments({ org }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ view: null, codes: [], savings: null, error: null });
  const [copied, setCopied] = useState(null);

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
      return { view: brandPaymentsView({ orders, payments }), codes, savings };
    })().then(
      (loaded) => !cancelled && setState({ ...loaded, error: null }),
      (error) => !cancelled && setState({ view: null, codes: [], savings: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id]);

  if (state.error) {
    return <main className="billing-page-shell"><p className="live-profile-error" role="alert">Couldn't load your payments: {state.error.message}</p></main>;
  }
  if (!state.view) {
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
    <main className="billing-page-shell">
      <BillingScreen
        accountType="brand"
        live={{
          metrics: state.view.metrics,
          rows: state.view.rows.map((row) => ({
            ...row,
            href: `/app.html/orders/${row.orderId}/payments/${row.id}`,
            onOpen: () => navigate(`/orders/${row.orderId}/payments/${row.id}`),
          })),
          empty: "No payments yet. A payment shows here once a step on one of your orders falls due.",
          discount: state.savings ? { amount: state.savings.amount, note: state.savings.note } : null,
          codes: state.codes,
          onCopy: copy,
          copied,
        }}
      />
    </main>
  );
}
