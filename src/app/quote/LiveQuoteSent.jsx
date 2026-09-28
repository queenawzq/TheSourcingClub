/**
 * The confirmation after a quote goes out, on Queena's designed screen.
 *
 * `FactoryQuoteSent` comes from src/factory-prototype/main.jsx. This file is
 * the seam — it names the brand the quote actually went to, rather than the
 * design's example.
 */
import React, { useEffect, useState } from "react";
import { FactoryQuoteSent } from "../../factory-prototype/main.jsx";
import { getRfq } from "../../lib/domain/rfq.js";
import { getMyQuote, getSampleLines } from "../../lib/domain/quote.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export default function LiveQuoteSent({ org, rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [sent, setSent] = useState(null);

  useEffect(() => {
    getRfq(rfqId).then(setRfq).catch(() => setRfq(null));
  }, [rfqId]);

  // The figures on this page are the vendor's own quote. They were the
  // design's example — $18.40, 300 units, 28 days, $5,780 — on every send.
  useEffect(() => {
    if (!org?.id) return undefined;
    let cancelled = false;
    (async () => {
      const quote = await getMyQuote(rfqId, org.id).catch(() => null);
      if (!quote || cancelled) return;
      const lines = (await getSampleLines(quote.id).catch(() => [])) ?? [];
      const production = (quote.unit_price_cents ?? 0) * (quote.production_quantity ?? 0);
      const samples = lines.reduce((sum, line) => sum + (line.cost_cents ?? 0), 0);
      if (cancelled) return;
      setSent({
        unitPrice: quote.unit_price_cents ? formatMoney(quote.unit_price_cents) : "—",
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "—",
        leadTime: quote.bulk_lead_time_days ? `${quote.bulk_lead_time_days} days` : "—",
        total: production ? formatMoney(production + samples) : "—",
        quoteDue: null,
      });
    })();
    return () => { cancelled = true; };
  }, [rfqId, org?.id]);

  return (
    <FactoryQuoteSent
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      language="en"
      project={{
        title: rfq?.title ?? "your quote",
        brand: rfq?.orgs?.name ?? "the brand",
        quantity: rfq?.quantity_total ? `${rfq.quantity_total} units` : "",
        images: [],
        tags: [],
        capacity: [],
      }}
      sent={sent && {
        ...sent,
        quoteDue: rfq?.quote_deadline ? DAY.format(new Date(rfq.quote_deadline)) : "—",
      }}
      onBack={() => navigate(`/browse/${rfqId}/quote`)}
      onDashboard={() => navigate("/")}
    />
  );
}
