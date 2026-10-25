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
 * the balance is short. If the balance fell short since the page loaded, the
 * database refuses with the price and the balance, and the screen shows that
 * as the design's "Not enough credits", with its buy action.
 */
import React, { useEffect, useState } from "react";
import { FactoryReviewTotal } from "../../factory-prototype/main.jsx";
import { getRfq, matchScoresForRfq } from "../../lib/domain/rfq.js";
import { getRfqDocumentPresentation } from "../../lib/domain/documents.js";
import {
  formatCapacityWindow,
  formatDayRange,
  getMaterialLines,
  getMyQuote,
  getSampleLines,
  quoteSubtotals,
  quoteTotalCents,
  quoteTotalMaxCents,
  submitQuote,
} from "../../lib/domain/quote.js";
import { creditBalance, quoteCreditCost } from "../../lib/domain/credits.js";
import { CreditPurchaseDialog } from "../order/CreditPurchase.jsx";
import { listLinks, listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { matchFit } from "../rfq/match-fit.js";
import { sourcingChoiceLabel } from "../rfq/resume-fields.js";
import { getRequestOrigin, withRequestOrigin } from "../rfq/request-origin.js";

// The same day format as the quote-sent screen, so "Quote due" reads alike.
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

// submit_quote()'s refusal when the balance is short (migration
// 20261022000400): "sending this quote costs 25 credits and you have 10".
const SHORT_OF_CREDITS = /costs (\d+) credits and you have (-?\d+)/;

export default function LiveQuoteReview({ org, rfqId, profile, isOwner = false }) {
  const { navigate } = useRouter();
  const requestOrigin = getRequestOrigin();
  const quotePath = withRequestOrigin(`/browse/${rfqId}/quote`, requestOrigin);
  const sentPath = withRequestOrigin(`/browse/${rfqId}/quote/sent`, requestOrigin);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // An owner short of credits buys them here and sends, without leaving the quote.
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rfq, quote, cost, balance, scores, terms, documents, linkedTermIds] = await Promise.all([
          getRfq(rfqId),
          getMyQuote(rfqId, org.id),
          quoteCreditCost(),
          creditBalance(org.id),
          matchScoresForRfq(rfqId, [org.id]).catch(() => new Map()),
          listTermsByKind(["sourcing_responsibility", "certification", "service"]),
          getRfqDocumentPresentation(rfqId).catch(() => ({ files: [], images: [] })),
          listLinks("rfq", rfqId),
        ]);
        const [lines, materialLines] = quote?.id
          ? await Promise.all([getSampleLines(quote.id), getMaterialLines(quote.id)])
          : [[], []];
        const certifications = (terms.certification ?? [])
          .filter((term) => linkedTermIds.includes(term.id))
          .map((term) => termLabel(term));
        const services = (terms.service ?? [])
          .filter((term) => linkedTermIds.includes(term.id))
          .map((term) => termLabel(term));
        if (!cancelled) setState({ rfq, quote, cost, balance, lines: lines ?? [], materialLines: materialLines ?? [], matchScore: scores.get(org.id) ?? null, terms, documents, certifications, services });
      } catch (failure) {
        if (!cancelled) setError(failure);
      }
    })();
    return () => { cancelled = true; };
  }, [rfqId, org.id]);

  if (error && !state) return <p className="composer-error" role="alert">{error.message}</p>;
  if (!state) return null;

  const { rfq, quote, cost, balance, lines, materialLines, matchScore, terms, documents, certifications, services } = state;
  const fit = matchFit(matchScore);
  const selectedSourcing = (terms.sourcing_responsibility ?? []).find(
    (term) => term.id === rfq.sourcing_responsibility_term_id,
  );

  // A vendor who has already sent this quote belongs on the confirmation, not
  // on a page offering to charge them again.
  if (!quote) return <p className="composer-error" role="alert">Start a quote before reviewing it.</p>;
  if (quote.status !== "draft") {
    navigate(sentPath);
    return null;
  }

  // The figures the brand will see, materials charged separately included.
  const figures = { ...quote, ...quoteSubtotals(quote, { sampleLines: lines, materialLines }) };
  const sampleTotal = figures.sampleSubtotalCents;
  const productionMin = figures.productionSubtotalCents ?? 0;
  const productionMax = figures.productionSubtotalMaxCents ?? 0;

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitQuote(quote.id);
      navigate(sentPath);
    } catch (failure) {
      // A credits problem, not a quote problem: the balance the database
      // read goes on screen, which draws "Not enough credits" and the buy
      // action instead of "Quote not ready to send".
      const shortfall = SHORT_OF_CREDITS.exec(failure.message ?? "");
      if (shortfall) {
        setState((current) => ({ ...current, cost: Number(shortfall[1]), balance: Number(shortfall[2]) }));
      } else {
        setError(failure);
      }
      setBusy(false);
    }
  }

  return (
    <>
    <FactoryReviewTotal
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      language="en"
      creditBalance={balance}
      creditCost={cost}
      quoteType={null}
      busy={busy}
      error={error?.message ?? null}
      quoteValues={{
        brandQuestions: [],
        brandSourcing: {
          material: rfq.material_notes ?? "",
          responsibility: sourcingChoiceLabel(selectedSourcing),
          details: rfq.sourcing_details ?? "",
          services: services.join(", "),
        },
        brandAdditionalDetails: rfq.additional_details ?? "",
        materialCosts: materialLines.map((line) => ({
          id: line.id,
          material: line.material,
          costPerUnit: line.cost_cents == null ? null : line.cost_cents / 100,
          included: line.included,
        })),
        unitPrice: quote.unit_price_cents
          ? formatRange(quote.unit_price_cents, quote.unit_price_max_cents ?? quote.unit_price_cents, quote.currency)
          : "",
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "",
        leadTime: formatDayRange(quote.bulk_lead_time_days, quote.bulk_lead_time_max_days),
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
          [`sample.${index}.timing`, formatDayRange(line.timing_days, line.timing_max_days)],
          [`sample.${index}.includes`, line.includes ?? ""],
        ])),
      }}
      project={{
        title: rfq.title || "Request",
        brand: rfq.orgs?.name ?? "",
        initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "",
        specialty: rfq.brief ?? "",
        budget: formatRange(
          rfq.target_unit_price_min_cents,
          rfq.target_unit_price_max_cents,
          rfq.currency,
        ),
        samples: rfq.requires_sample ? "Sample required" : "No sample",
        quoteDue: rfq.quote_deadline ? DAY.format(new Date(rfq.quote_deadline)) : "",
        location: "",
        images: documents.images,
        tags: [],
        certifications,
        services,
        capacity: fit ? [fit.label] : [],
        fitTone: fit?.tone ?? "",
        files: documents.files.map((file) => file.file_name),
        paymentVerified: false,
        trust: "",
        posted: "",
      }}
      priceTotal={{
        brand: rfq.orgs?.name ?? "",
        location: "",
        unitPrice: quote.unit_price_cents
          ? formatRange(quote.unit_price_cents, quote.unit_price_max_cents ?? quote.unit_price_cents, quote.currency)
          : "—",
        quantity: quote.production_quantity ? `${quote.production_quantity} units` : "—",
        productionSubtotal: productionMin ? formatRange(productionMin, productionMax, quote.currency) : "—",
        samplePlan: lines.length ? lines.map((line) => line.stage).filter(Boolean).join(" + ") : "—",
        sampleTotal: lines.length ? formatMoney(sampleTotal) : "—",
        paymentTerms: quote.deposit_pct
          ? `${quote.deposit_pct}% / ${quote.balance_pct ?? 100 - quote.deposit_pct}%`
          : "—",
        brandSees: productionMin
          ? formatRange(quoteTotalCents(figures), quoteTotalMaxCents(figures), quote.currency)
          : "—",
      }}
      onBack={() => navigate(quotePath)}
      onEdit={() => navigate(quotePath)}
      onPurchaseCredits={() => (isOwner ? setBuying(true) : navigate("/payout?tab=credits"))}
      // The draft was saved on the way here, so "Save draft" is leaving it for
      // later: it waits under Drafts on the RFQs page.
      onSaveDraft={() => navigate("/rfqs")}
      onSendQuote={send}
    />
    {buying ? (
      <CreditPurchaseDialog
        orgId={org.id}
        onClose={() => setBuying(false)}
        onPurchased={async () => {
          setError(null);
          const fresh = await creditBalance(org.id).catch(() => null);
          if (fresh !== null) setState((current) => ({ ...current, balance: fresh }));
        }}
      />
    ) : null}
    </>
  );
}
