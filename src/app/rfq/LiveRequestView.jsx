/**
 * A request as a factory reads it, on Queena's designed screen.
 *
 * `FactoryReadOnlyRfqPage` comes from src/factory-prototype/main.jsx. This
 * file is the seam.
 *
 * What reaches this screen is decided by RLS: the brand's contact details are
 * not in the select because they are not in the policy, so there is nothing
 * here to accidentally show. Quoting is gated separately — an unverified
 * factory can read every word of this and still be refused at the quote,
 * which is what makes verification the thing that unlocks earning.
 */
import React, { useEffect, useState } from "react";
import { FactoryReadOnlyRfqPage } from "../../factory-prototype/main.jsx";
import { getQuestions, getRfq } from "../../lib/domain/rfq.js";
import { getMyQuote } from "../../lib/domain/quote.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

export default function LiveRequestView({ org, rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [myQuote, setMyQuote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRfq(rfqId), getQuestions(rfqId), org?.id ? getMyQuote(rfqId, org.id) : null])
      .then(([request, asked, quote]) => {
        if (cancelled) return;
        setRfq(request);
        setQuestions(asked ?? []);
        setMyQuote(quote ?? null);
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [rfqId, org?.id]);

  if (error) return <p className="composer-error" role="alert">{error.message}</p>;
  if (!rfq) return null;

  const verified = profile?.verification_status === "verified";

  return (
    <>
      {!verified && (
        <div className="browse-gate">
          <strong>You can read this, but not quote it yet.</strong>
          <span>
            Your business registration is with our review team. Quoting opens as soon as it
            is approved.
          </span>
        </div>
      )}
      <FactoryReadOnlyRfqPage
        companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
        language="en"
        project={{
          title: rfq.title || "Request",
          brand: rfq.orgs?.name ?? "",
          initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
          location: "",
          posted: "",
          // No per-pair score is asked for here, so none is shown.
          match: "",
          quoteDue: rfq.quote_deadline
            ? new Date(rfq.quote_deadline).toLocaleDateString("en", { month: "short", day: "numeric" })
            : "",
          budget: formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency),
          quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
          samples: rfq.requires_sample ? "Sample required" : "No sample",
          specialty: rfq.brief ?? rfq.material_notes ?? "",
          // The brand's own questions, which are the point of the screen for a
          // factory: they are what it has to answer to quote.
          questions: questions.map((question) => question.prompt),
          tags: [],
          // Real requests carry their own attachments; none means no row.
          files: [],
          capacity: [],
          images: [],
          fitTone: "",
          trust: "",
          insight: [],
        }}
        // No quote from this vendor yet, so every field on the quote panel is
        // blank rather than the design's example figures.
        quote={{
          brandQuestions: questions.map((question) => question.prompt),
          // This vendor's own quote where it has one, blank where it has not.
          unitPrice: myQuote?.unit_price_cents ? formatMoney(myQuote.unit_price_cents) : "",
          quantity: myQuote?.production_quantity ? `${myQuote.production_quantity} units` : "",
          leadTime: myQuote?.bulk_lead_time_days ? `${myQuote.bulk_lead_time_days} days` : "",
          capacityWindow: "",
          paymentTerms: myQuote?.deposit_pct ? `${myQuote.deposit_pct}% deposit / ${myQuote.balance_pct ?? 100 - myQuote.deposit_pct}% balance` : "",
          incoterms: "",
          validUntil: myQuote?.valid_until
            ? new Date(myQuote.valid_until).toLocaleDateString("en", { dateStyle: "medium" })
            : "",
          "sample.0.stage": "", "sample.0.cost": "", "sample.0.timing": "", "sample.0.includes": "",
          "sample.1.stage": "", "sample.1.cost": "", "sample.1.timing": "", "sample.1.includes": "",
        }}
        // What this vendor actually sent, or nothing at all. The design's
        // status card otherwise states a $18.40 quote to another brand.
        status={myQuote ? {
          summary: myQuote.status === "submitted"
            ? `Your quote was submitted and is visible to ${rfq.orgs?.name ?? "the brand"}.`
            : `Your quote is a ${myQuote.status} and has not been sent yet.`,
          price: myQuote.unit_price_cents ? formatMoney(myQuote.unit_price_cents) : "—",
          sent: myQuote.submitted_at
            ? new Date(myQuote.submitted_at).toLocaleDateString("en", { month: "short", day: "numeric" })
            : "—",
          label: myQuote.status === "submitted" ? "Quote submitted" : myQuote.status,
        } : {
          summary: "You have not quoted this request yet.",
          price: "—",
          sent: "—",
          label: "No quote",
        }}
        onBack={() => navigate("/browse")}
        onEdit={verified ? () => navigate(`/browse/${rfqId}/quote`) : undefined}
      />
    </>
  );
}
