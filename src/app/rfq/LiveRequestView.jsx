/**
 * A request as a factory reads it, on Queena's designed screens.
 *
 * There are two of them, and which one is right depends on whether this vendor
 * has quoted yet:
 *
 *   * no quote  → `FactoryProjectDetail`, the design's "RFQ details" — the
 *     request, the brand behind it, how well it matches, and the primary
 *     action that matters: Send quote.
 *   * a draft or a submitted quote → `FactoryReadOnlyRfqPage`, which reads
 *     back what was sent.
 *
 * Only the second was ever mounted, so a vendor that had never quoted was
 * shown a read-back of a quote that did not exist, with no way forward but a
 * secondary "Edit quote" button.
 *
 * What reaches this screen is decided by RLS: the brand's contact details are
 * not in the select because they are not in the policy, so there is nothing
 * here to accidentally show. Quoting is gated separately — an unverified
 * factory can read every word of this and still be refused at the quote,
 * which is what makes verification the thing that unlocks earning.
 */
import React, { useEffect, useState } from "react";
import { FactoryProjectDetail, FactoryReadOnlyRfqPage } from "../../factory-prototype/main.jsx";
import {
  brandSummary,
  getQuestions,
  getRfq,
  isRequestSaved,
  lastBrandView,
  matchScoresForRfq,
  saveRequest,
  unsaveRequest,
} from "../../lib/domain/rfq.js";
import { getMyQuote, getSampleLines } from "../../lib/domain/quote.js";
import { listRfqDocuments, urlFor } from "../../lib/domain/documents.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/** "12 min ago", "3 days ago" — the vendor only needs the shape of it. */
function ago(when) {
  if (!when) return null;
  const minutes = Math.round((Date.now() - new Date(when).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The score bands the database already defines, as the design draws them. */
const MATCH_BANDS = [
  [90, "Strong fit", "strong"],
  [75, "Good fit", "good"],
  [60, "Potential fit", "potential"],
];

export default function LiveRequestView({ org, user, rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [myQuote, setMyQuote] = useState(null);
  const [sampleLines, setSampleLines] = useState([]);
  const [extras, setExtras] = useState({ match: null, brand: null, quoteCount: 0, lastView: null, files: [], saved: false });
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

  // The panels around the request: how well it matches, who the brand is,
  // what is happening on it, and whether this vendor saved it. Each fails
  // quietly on its own — none of them is worth losing the screen over.
  useEffect(() => {
    if (!rfq || !org?.id) return undefined;
    let cancelled = false;
    Promise.all([
      matchScoresForRfq(rfq.id, [org.id]).catch(() => new Map()),
      rfq.brand_org_id ? brandSummary(rfq.brand_org_id).catch(() => null) : null,
      lastBrandView(rfq.id),
      listRfqDocuments(rfq.id).catch(() => []),
      isRequestSaved(org.id, rfq.id).catch(() => false),
    ])
      .then(([scores, summary, viewed, files, savedAlready]) => {
        if (cancelled) return;
        setExtras({
          match: scores.get(org.id) ?? null,
          brand: summary,
          quoteCount: Number(rfq.quotes?.[0]?.count) || 0,
          lastView: viewed,
          files: files ?? [],
          saved: Boolean(savedAlready),
        });
      });
    return () => { cancelled = true; };
  }, [rfq, org?.id]);

  // The vendor's own sample plan, so the read-back is the quote it sent.
  useEffect(() => {
    if (!myQuote?.id) return undefined;
    let cancelled = false;
    getSampleLines(myQuote.id).then((lines) => !cancelled && setSampleLines(lines ?? []), () => {});
    return () => { cancelled = true; };
  }, [myQuote?.id]);

  async function toggleSave() {
    if (!org?.id) return;
    const next = !extras.saved;
    setExtras((current) => ({ ...current, saved: next }));
    try {
      if (next) await saveRequest(org.id, rfq.id, user?.id ?? null);
      else await unsaveRequest(org.id, rfq.id);
    } catch (failure) {
      setExtras((current) => ({ ...current, saved: !next }));
      setError(failure);
    }
  }

  if (error) return <p className="composer-error" role="alert">{error.message}</p>;
  if (!rfq) return null;

  const verified = profile?.verification_status === "verified";
  const isTrading = profile?.vendor_kind === "trading_company";

  // The request itself, in the shape both designed screens read.
  const project = {
    title: rfq.title || "Request",
    brand: rfq.orgs?.name ?? "",
    initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
    location: extras.brand?.hq_location ?? "",
    posted: rfq.published_at ? `Posted ${DAY.format(new Date(rfq.published_at))}` : "",
    quoteDue: rfq.quote_deadline ? DAY.format(new Date(rfq.quote_deadline)) : "",
    budget: formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency),
    quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
    samples: rfq.requires_sample ? "Sample required" : "No sample",
    specialty: rfq.brief ?? rfq.material_notes ?? "",
    questions: questions.map((question) => question.prompt),
    // A claim about the brand, so only when the brand summary says so.
    paymentVerified: extras.brand ? Boolean(extras.brand.payment_verified) : false,
    trust: extras.brand?.trust_band ?? "",
    tags: [],
    capacity: [],
    images: [],
    fitTone: "",
    insight: [],
  };

  const gate = !verified && (
    <div className="browse-gate">
      <strong>You can read this, but not quote it yet.</strong>
      <span>
        Your business registration is with our review team. Quoting opens as soon as it
        is approved.
      </span>
    </div>
  );

  // No quote from this vendor yet: the design's RFQ details screen, whose
  // primary action is the one thing this vendor is here to do.
  if (!myQuote) {
    const band = MATCH_BANDS.find(([floor]) => (extras.match ?? -1) >= floor);
    return (
      <>
        {gate}
        <FactoryProjectDetail
          companyType={isTrading ? "trading" : "factory"}
          language="en"
          project={project}
          brief={rfq.brief ?? ""}
          details={{
            colorSplit: "",
            bulkTimeline: rfq.target_delivery_month ?? "",
          }}
          materials={{
            mainMaterial: rfq.material_notes ?? "",
            quality: "",
            factorySources: "",
            brandProvides: "",
            confirmInQuote: "",
          }}
          attachments={extras.files.map((file) => ({
            name: file.file_name,
            onOpen: async () => {
              const href = await urlFor(file);
              if (href) window.open(href, "_blank", "noopener");
            },
          }))}
          questions={project.questions}
          capabilities={[]}
          match={extras.match === null ? null : {
            summary: `Your profile scores ${extras.match}% against this request.`,
            label: band ? band[1] : "",
            tone: band ? band[2] : "",
          }}
          brand={extras.brand ? {
            initials: (extras.brand.name ?? "??").slice(0, 2).toUpperCase(),
            name: extras.brand.name ?? "",
            location: extras.brand.hq_location ?? "",
            verified: extras.brand.verified ? "Yes" : "Not yet",
            clubOrders: String(extras.brand.club_order_count ?? 0),
            avgResponse: extras.brand.avg_response_hours
              ? `${Math.round(Number(extras.brand.avg_response_hours))} hours`
              : "No replies yet",
            paymentStatus: extras.brand.payment_verified ? "Verified" : "Not verified",
          } : null}
          activity={[
            `${extras.quoteCount} quote${extras.quoteCount === 1 ? "" : "s"} received`,
            extras.lastView ? `Last viewed by brand: ${ago(extras.lastView)}` : null,
            rfq.quote_deadline ? `Quotes close ${DAY.format(new Date(rfq.quote_deadline))}` : null,
          ].filter(Boolean)}
          saved={extras.saved}
          onToggleSave={toggleSave}
          onBack={() => navigate("/browse")}
          onSendQuote={verified ? () => navigate(`/browse/${rfqId}/quote`) : undefined}
        />
      </>
    );
  }

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
        companyType={isTrading ? "trading" : "factory"}
        language="en"
        project={{ ...project, files: [] }}
        // This vendor's own quote, read back: the terms it sent and the
        // sample plan it priced, not the design's example.
        quote={{
          brandQuestions: project.questions,
          unitPrice: myQuote.unit_price_cents ? formatMoney(myQuote.unit_price_cents) : "",
          quantity: myQuote.production_quantity ? `${myQuote.production_quantity} units` : "",
          leadTime: myQuote.bulk_lead_time_days ? `${myQuote.bulk_lead_time_days} days` : "",
          capacityWindow: "",
          paymentTerms: myQuote.deposit_pct
            ? `${myQuote.deposit_pct}% deposit / ${myQuote.balance_pct ?? 100 - myQuote.deposit_pct}% balance`
            : "",
          incoterms: "",
          validUntil: myQuote.valid_until
            ? new Date(`${myQuote.valid_until}T00:00:00`).toLocaleDateString("en", { dateStyle: "medium" })
            : "",
          ...Object.fromEntries(sampleLines.flatMap((line, index) => [
            [`sample.${index}.stage`, line.stage ?? ""],
            [`sample.${index}.cost`, line.cost_cents ? formatMoney(line.cost_cents) : ""],
            [`sample.${index}.timing`, line.timing_days ? `${line.timing_days} days` : ""],
            [`sample.${index}.includes`, line.includes ?? ""],
          ])),
        }}
        // The totals the brand will see, computed from this quote.
        priceTotal={{
          brand: rfq.orgs?.name ?? "",
          location: extras.brand?.hq_location ?? "",
          unitPrice: myQuote.unit_price_cents ? formatMoney(myQuote.unit_price_cents) : "—",
          quantity: myQuote.production_quantity ? `${myQuote.production_quantity} units` : "—",
          productionSubtotal: myQuote.unit_price_cents && myQuote.production_quantity
            ? formatMoney(myQuote.unit_price_cents * myQuote.production_quantity)
            : "—",
          samplePlan: sampleLines.length
            ? sampleLines.map((line) => line.stage).filter(Boolean).join(" + ")
            : "—",
          sampleTotal: sampleLines.length
            ? formatMoney(sampleLines.reduce((sum, line) => sum + (line.cost_cents ?? 0), 0))
            : "—",
          paymentTerms: myQuote.deposit_pct
            ? `${myQuote.deposit_pct}% / ${myQuote.balance_pct ?? 100 - myQuote.deposit_pct}%`
            : "—",
          brandSees: myQuote.unit_price_cents && myQuote.production_quantity
            ? formatMoney(
              myQuote.unit_price_cents * myQuote.production_quantity
              + sampleLines.reduce((sum, line) => sum + (line.cost_cents ?? 0), 0),
            )
            : "—",
        }}
        status={{
          summary: myQuote.status === "submitted"
            ? `Your quote was submitted and is visible to ${rfq.orgs?.name ?? "the brand"}.`
            : `Your quote is a ${myQuote.status} and has not been sent yet.`,
          price: myQuote.unit_price_cents ? formatMoney(myQuote.unit_price_cents) : "—",
          sent: myQuote.submitted_at
            ? DAY.format(new Date(myQuote.submitted_at))
            : "—",
          label: myQuote.status === "submitted" ? "Quote submitted" : myQuote.status,
        }}
        onBack={() => navigate("/browse")}
        onEdit={verified ? () => navigate(`/browse/${rfqId}/quote`) : undefined}
      />
    </>
  );
}
