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
import { getMyQuote, getSampleLines, reviseQuote } from "../../lib/domain/quote.js";
import { quoteCreditCost } from "../../lib/domain/credits.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import QuoteActionDialog, { reviseCopy } from "./QuoteActionDialog.jsx";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export default function LiveQuoteSent({ org, rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [sent, setSent] = useState(null);
  const [quote, setQuote] = useState(null);
  const [asking, setAsking] = useState(false);
  const [creditCost, setCreditCost] = useState(null);

  useEffect(() => {
    getRfq(rfqId).then(setRfq).catch(() => setRfq(null));
    quoteCreditCost().then(setCreditCost, () => {});
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
      setQuote(quote);
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

  // "Back to edit quote" on a quote that has gone out is a revision: it takes
  // the quote out of the brand's comparison until it is sent again, for
  // another charge. It used to open the form on the sent row, which could not
  // save. A quote that is still a draft (the send failed) just goes back.
  function backToEdit() {
    if (quote?.status === "submitted" && rfq?.status === "open") setAsking(true);
    else navigate(quote?.status === "draft" ? `/browse/${rfqId}/quote` : `/browse/${rfqId}`);
  }

  return (
    <>
      {asking && (
        <QuoteActionDialog
          testId="revise-quote-dialog"
          {...reviseCopy(rfq?.orgs?.name, creditCost)}
          onConfirm={async () => {
            await reviseQuote(quote.id);
            navigate(`/browse/${rfqId}/quote`);
          }}
          onClose={() => setAsking(false)}
        />
      )}
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
        onBack={backToEdit}
        onDashboard={() => navigate("/")}
        onBrowse={() => navigate("/browse")}
      />
    </>
  );
}
