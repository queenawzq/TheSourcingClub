/**
 * The review step, on Queena's designed screen.
 *
 * `FactoryReviewTotal` is the third of the design's four: details, prepare,
 * review, sent. It is where the vendor sees the total the brand will see and
 * what sending costs, and it is the only place the quote is actually sent —
 * the form behind it saves a draft and nothing more.
 *
 * The credits are spent by submit_quote() itself, in the same transaction
 * that flips the status, so a quote can never be sent unpaid or paid unsent.
 * This screen only reports the price and the balance, and refuses to try when
 * the balance is short.
 */
import React, { useEffect, useState } from "react";
import { FactoryReviewTotal } from "../../factory-prototype/main.jsx";
import { getRfq } from "../../lib/domain/rfq.js";
import { formatCapacityWindow, getMyQuote, getSampleLines, submitQuote } from "../../lib/domain/quote.js";
import { creditBalance, quoteCreditCost } from "../../lib/domain/credits.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

export default function LiveQuoteReview({ org, rfqId, profile }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rfq, quote, cost, balance] = await Promise.all([
          getRfq(rfqId),
          getMyQuote(rfqId, org.id),
          quoteCreditCost(),
          creditBalance(org.id),
        ]);
        const lines = quote?.id ? await getSampleLines(quote.id) : [];
        if (!cancelled) setState({ rfq, quote, cost, balance, lines: lines ?? [] });
      } catch (failure) {
        if (!cancelled) setError(failure);
      }
    })();
    return () => { cancelled = true; };
  }, [rfqId, org.id]);

  if (error && !state) return <p className="composer-error" role="alert">{error.message}</p>;
  if (!state) return null;

  const { rfq, quote, cost, balance, lines } = state;

  // A vendor who has already sent this quote belongs on the confirmation, not
  // on a page offering to charge them again.
  if (!quote) return <p className="composer-error" role="alert">Start a quote before reviewing it.</p>;
  if (quote.status !== "draft") {
    navigate(`/browse/${rfqId}/quote/sent`);
    return null;
  }

  const sampleTotal = lines.reduce((sum, line) => sum + (line.cost_cents ?? 0), 0);
  const production = (quote.unit_price_cents ?? 0) * (quote.production_quantity ?? 0);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitQuote(quote.id);
      navigate(`/browse/${rfqId}/quote/sent`);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <FactoryReviewTotal
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      language="en"
      creditBalance={balance}
      creditCost={cost}
      busy={busy}
      error={error?.message ?? null}
      quoteValues={{
        brandQuestions: [],
        unitPrice: quote.unit_price_cents ? formatMoney(quote.unit_price_cents) : "",
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "",
        leadTime: quote.bulk_lead_time_days ? `${quote.bulk_lead_time_days} days` : "",
        capacityWindow: formatCapacityWindow(quote),
        paymentTerms: quote.deposit_pct
          ? `${quote.deposit_pct}% deposit / ${quote.balance_pct ?? 100 - quote.deposit_pct}% balance`
          : "",
        incoterms: quote.shipping_notes ?? "",
        validUntil: quote.valid_until
          // A bare date parses as UTC midnight and renders a day early west
          // of Greenwich — a quote typed as valid to the 30th expiring on the
          // 29th. Pinning the time makes it local.
          ? new Date(`${quote.valid_until}T00:00:00`).toLocaleDateString("en", { dateStyle: "medium" })
          : "",
        ...Object.fromEntries(lines.flatMap((line, index) => [
          [`sample.${index}.stage`, line.stage ?? ""],
          [`sample.${index}.cost`, line.cost_cents ? formatMoney(line.cost_cents) : ""],
          [`sample.${index}.timing`, line.timing_days ? `${line.timing_days} days` : ""],
          [`sample.${index}.includes`, line.includes ?? ""],
        ])),
      }}
      project={{
        title: rfq.title || "Request",
        brand: rfq.orgs?.name ?? "",
        initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "",
        specialty: rfq.brief ?? "",
        budget: "",
        samples: rfq.requires_sample ? "Sample required" : "No sample",
        quoteDue: "",
        location: "",
        images: [],
        tags: [],
        capacity: [],
        fitTone: "",
        files: [],
        paymentVerified: false,
        trust: "",
        posted: "",
      }}
      priceTotal={{
        brand: rfq.orgs?.name ?? "",
        location: "",
        unitPrice: quote.unit_price_cents ? formatMoney(quote.unit_price_cents) : "—",
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "—",
        productionSubtotal: production ? formatMoney(production) : "—",
        samplePlan: lines.length ? lines.map((line) => line.stage).filter(Boolean).join(" + ") : "—",
        sampleTotal: lines.length ? formatMoney(sampleTotal) : "—",
        paymentTerms: quote.deposit_pct
          ? `${quote.deposit_pct}% / ${quote.balance_pct ?? 100 - quote.deposit_pct}%`
          : "—",
        brandSees: production ? formatMoney(production + sampleTotal) : "—",
      }}
      onBack={() => navigate(`/browse/${rfqId}/quote`)}
      onEdit={() => navigate(`/browse/${rfqId}/quote`)}
      onPurchaseCredits={() => navigate("/payout")}
      // The draft was saved on the way here, so "Save draft" is leaving it for
      // later: it waits under Drafts on the RFQs page.
      onSaveDraft={() => navigate("/rfqs")}
      onSendQuote={send}
    />
  );
}
