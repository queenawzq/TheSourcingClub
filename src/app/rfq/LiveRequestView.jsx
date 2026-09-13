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
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

export default function LiveRequestView({ rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRfq(rfqId), getQuestions(rfqId)])
      .then(([request, asked]) => {
        if (cancelled) return;
        setRfq(request);
        setQuestions(asked ?? []);
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [rfqId]);

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
          unitPrice: "", quantity: "", leadTime: "", paymentTerms: "", incoterms: "", validUntil: "",
          "sample.0.stage": "", "sample.0.cost": "", "sample.0.timing": "", "sample.0.includes": "",
          "sample.1.stage": "", "sample.1.cost": "", "sample.1.timing": "", "sample.1.includes": "",
        }}
        onBack={() => navigate("/browse")}
        onEdit={verified ? () => navigate(`/browse/${rfqId}/quote`) : undefined}
      />
    </>
  );
}
