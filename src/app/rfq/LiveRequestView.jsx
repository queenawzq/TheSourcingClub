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
  brandProfileForFactory,
  brandSummary,
  getQuestions,
  getRfq,
  isRequestSaved,
  lastBrandView,
  matchScoresForRfq,
  saveRequest,
  unsaveRequest,
} from "../../lib/domain/rfq.js";
import { formatCapacityWindow, getLatestQuote, getSampleLines, reviseQuote, withdrawQuote } from "../../lib/domain/quote.js";
import { quoteCreditCost } from "../../lib/domain/credits.js";
import { listRfqDocuments, urlFor } from "../../lib/domain/documents.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import QuoteActionDialog, { reviseCopy } from "../quote/QuoteActionDialog.jsx";
import "../profile/profile.css";

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

/**
 * What happened to this vendor's quote, in words. Every status gets its own
 * sentence: the old fallback read "Your quote is a declined and has not been
 * sent yet" on a quote that was sent and then lost, or closed by a cancel.
 */
function statusOf(quote, rfq) {
  const brand = rfq.orgs?.name ?? "The brand";
  switch (quote.status) {
    case "submitted":
      return { summary: `Your quote was submitted and is visible to ${rfq.orgs?.name ?? "the brand"}.`, label: "Quote submitted" };
    case "accepted":
      return { summary: `${brand} chose your quote. The order is under Production orders.`, label: "Accepted" };
    case "declined":
      return rfq.status === "cancelled"
        ? { summary: `${brand} cancelled this request, so your quote was closed.`, label: "Request cancelled" }
        : { summary: `${brand} chose another quote.`, label: "Not selected" };
    case "withdrawn":
      return { summary: "You withdrew this quote.", label: "Withdrawn" };
    default:
      return { summary: "Your quote is a draft and has not been sent yet.", label: "Draft" };
  }
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
  const [extras, setExtras] = useState({ match: null, brand: null, lastView: null, files: [], saved: false });
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // "revise" or "withdraw" while the vendor is being asked; a sent quote is
  // changed only after they have read what it costs.
  const [asking, setAsking] = useState(null);
  const [creditCost, setCreditCost] = useState(null);
  // Bumped after a withdrawal so the quote is read again, not guessed at.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The latest quote, withdrawn included: a withdrawal is final, and this is
    // the page that has to say so.
    Promise.all([getRfq(rfqId), getQuestions(rfqId), org?.id ? getLatestQuote(rfqId, org.id) : null])
      .then(([request, asked, quote]) => {
        if (cancelled) return;
        setLoaded(true);
        setRfq(request);
        setQuestions(asked ?? []);
        setMyQuote(quote ?? null);
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [rfqId, org?.id, version]);

  useEffect(() => {
    quoteCreditCost().then(setCreditCost, () => {});
  }, []);

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
      // Its club orders: the summary predates orders and returns none.
      rfq.brand_org_id ? brandProfileForFactory(rfq.brand_org_id).catch(() => null) : null,
    ])
      .then(([scores, summary, viewed, files, savedAlready, profile]) => {
        if (cancelled) return;
        setExtras({
          match: scores.get(org.id) ?? null,
          brand: summary && { ...summary, club_order_count: summary.club_order_count ?? profile?.club_order_count ?? null },
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
  // A request the brand cancelled (or one this vendor was never shown) is not
  // readable any more. The "cancelled" notification links here, so say so
  // rather than render an empty page.
  if (loaded && !rfq) {
    return (
      <main className="home-page shell-body" data-testid="rfq-unavailable">
        <h1>This request is no longer open</h1>
        <p className="shell-note">
          The brand may have cancelled it, and any quote you sent on it has been closed.
        </p>
        <p className="shell-note">
          <button type="button" className="quiet-btn" onClick={() => navigate("/browse")}>← Browse open requests</button>
        </p>
      </main>
    );
  }
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
            // The brand's name opens its profile.
            profileHref: `/app.html/brands/${rfq.brand_org_id}?from=request`,
            onOpenProfile: () => navigate(`/brands/${rfq.brand_org_id}?from=request`),
            location: extras.brand.hq_location ?? "",
            verified: extras.brand.verified ? "Yes" : "Not yet",
            clubOrders: String(extras.brand.club_order_count ?? 0),
            avgResponse: extras.brand.avg_response_hours
              ? `${Math.round(Number(extras.brand.avg_response_hours))} hours`
              : "No replies yet",
            paymentStatus: extras.brand.payment_verified ? "Verified" : "Not verified",
          } : null}
          // No "N quotes received" line: RLS shows a vendor only its own
          // quotes, so the count read 0 on every request.
          activity={[
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

  const open = rfq.status === "open";
  const brandName = rfq.orgs?.name ?? "the brand";

  async function revise() {
    await reviseQuote(myQuote.id);
    navigate(`/browse/${rfqId}/quote`);
  }

  async function withdraw() {
    await withdrawQuote(myQuote.id);
    setAsking(null);
    setVersion((current) => current + 1);
  }

  // A draft opens straight into the form. A sent quote asks first, then
  // becomes a new draft version; the old form used to open on the sent row
  // and fail to save, because only a draft is editable.
  let onEdit = null;
  if (open && myQuote.status === "draft") onEdit = verified ? () => navigate(`/browse/${rfqId}/quote`) : undefined;
  if (open && myQuote.status === "submitted") onEdit = verified ? () => setAsking("revise") : undefined;

  return (
    <>
      {asking === "revise" && (
        <QuoteActionDialog
          testId="revise-quote-dialog"
          {...reviseCopy(brandName, creditCost)}
          onConfirm={revise}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === "withdraw" && (
        <QuoteActionDialog
          testId="withdraw-quote-dialog"
          title="Withdraw your quote?"
          body={`${brandName} will no longer see your quote. The credits spent sending it are not refunded, and you can't quote on this request again.`}
          confirmLabel="Withdraw quote"
          busyLabel="Withdrawing…"
          onConfirm={withdraw}
          onClose={() => setAsking(null)}
        />
      )}
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
          // What the vendor sent, as Review showed it before sending. Both read
          // blank here, on the one page meant to read the quote back.
          capacityWindow: formatCapacityWindow(myQuote),
          paymentTerms: myQuote.deposit_pct
            ? `${myQuote.deposit_pct}% deposit / ${myQuote.balance_pct ?? 100 - myQuote.deposit_pct}% balance`
            : "",
          incoterms: myQuote.shipping_notes ?? "",
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
          ...statusOf(myQuote, rfq),
          price: myQuote.unit_price_cents ? formatMoney(myQuote.unit_price_cents) : "—",
          sent: myQuote.submitted_at
            ? DAY.format(new Date(myQuote.submitted_at))
            : "—",
        }}
        onBack={() => navigate("/browse")}
        // Only a draft or a sent quote on an open request can still change.
        onEdit={onEdit}
        onWithdraw={open && myQuote.status === "submitted" ? () => setAsking("withdraw") : undefined}
      />
    </>
  );
}
