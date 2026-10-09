/**
 * Comparing quotes, on Queena's designed screen.
 *
 * `QuotesScreen` and `FlowShell` come from src/prototype/main.jsx. This file
 * is the seam.
 *
 * The design walks from here to one quote in full ("Review quote"), to the
 * conversation with that vendor ("Message"), and to the contract step
 * ("Choose quote"), where the terms are read back before award_quote commits
 * them. All three used to do nothing live: the screen was handed a goTo that
 * went nowhere.
 */
import React, { useState } from "react";
import { FlowShell, QuotesScreen } from "../../prototype/main.jsx";
import { openRfqThread } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import { useQuoteReview } from "./useQuoteReview.js";

export default function LiveQuotes({ rfqId }) {
  const { navigate } = useRouter();
  const { state, error: loadError } = useQuoteReview(rfqId);
  const [selected, setSelected] = useState(null);
  const [compare, setCompare] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [error, setError] = useState(null);

  async function message(card) {
    setError(null);
    try {
      const thread = await openRfqThread(rfqId, card.factoryOrgId);
      navigate(`/messages/${thread.id}`);
    } catch (failure) {
      setError(failure);
    }
  }

  if (loadError) {
    return (
      <FlowShell screen="quotes" canBack={false} primaryLabel="">
        <p className="composer-error" role="alert">{loadError.message}</p>
      </FlowShell>
    );
  }
  if (!state) return null;

  if (!state.quotes.length) {
    return (
      <FlowShell screen="quotes" canBack={false}>
        <p className="projects-empty" data-testid="quotes-empty">
          No quotes yet. Vendors you invited will appear here as they reply.
        </p>
      </FlowShell>
    );
  }

  /**
   * A live quote as the designed card expects one.
   *
   * The design shows a fit percentage and a response time on every card. Fit
   * is a per-pair score this list has not asked for, and response time is not
   * recorded at all — both are left empty rather than filled with a number
   * that came from nowhere.
   */
  const shaped = state.quotes.map(({ raw, view }) => ({
    id: view.id,
    factoryOrgId: raw.factory_org_id,
    profileHref: `/app.html/factories/${raw.factory_org_id}?from=quotes`,
    onOpenProfile: () => navigate(`/factories/${raw.factory_org_id}?from=quotes`),
    initials: view.initials,
    name: view.name,
    location: "",
    // The badge says TSC has checked this vendor, so only a verified one gets it.
    trust: raw.orgs?.factory_profiles?.verification_status === "verified" ? "trusted" : "",
    fit: "",
    response: "",
    fitType: `Version ${view.version}`,
    fitSummary: view.notes,
    factoryNote: raw.shipping_notes ?? "",
    price: view.price || "—",
    quoteQuantity: view.quantity || "—",
    lead: view.lead || "—",
    total: view.total || "—",
    stats: [
      ["Unit price", view.price || "—"],
      ["Quantity", view.quantity || "—"],
      ["Bulk lead time", view.lead || "—"],
      ["Total", view.total || "—"],
    ],
    // What the compare table prints, from this quote rather than the
    // prototype's per-vendor constants. Blank where the vendor gave nothing.
    comparison: {
      productionSubtotal: view.productionSubtotal || "—",
      sampleSubtotal: view.sampleSubtotal || "—",
      additionalMaterialSubtotal: "—",
      paymentTerms: view.paymentTerms || "—",
      samplePlan: view.samplePlan || "—",
      shipping: view.shipping || "—",
      capacityWindow: view.capacityWindow || "—",
      total: view.total || "—",
    },
    products: [],
    categories: [],
    capabilities: [],
    notes: view.notes ? [view.notes] : [],
    materialCosts: [],
    samples: [],
  }));

  return (
    <FlowShell screen="quotes" canBack={false} primaryLabel="">
      <QuotesScreen
        quotes={shaped}
        selectedQuote={selected}
        setSelectedQuote={setSelected}
        selectedQuotesForCompare={compare}
        setSelectedQuotesForCompare={setCompare}
        quoteCompareOpen={compareOpen}
        setQuoteCompareOpen={setCompareOpen}
        setSelectedReorderProject={() => {}}
        goTo={() => {}}
        onReview={(card) => navigate(`/rfqs/${rfqId}/quotes/${card.id}`)}
        onChoose={(card) => navigate(`/rfqs/${rfqId}/quotes/${card.id}/contract`)}
        onMessage={message}
        error={error}
      />
    </FlowShell>
  );
}
