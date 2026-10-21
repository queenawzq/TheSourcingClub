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
import { matchFit } from "../rfq/match-fit.js";
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
   * Fit comes from the same RFQ-to-factory profile score used while inviting
   * vendors, so brands see a consistent suitability label on the quote card.
   */
  const shaped = state.quotes.map(({ raw, view, matchScore }) => {
    const fit = matchFit(matchScore);
    return {
      id: view.id,
      factoryOrgId: raw.factory_org_id,
      profileHref: `/app.html/factories/${raw.factory_org_id}?from=quotes`,
      onOpenProfile: () => navigate(`/factories/${raw.factory_org_id}?from=quotes`),
      initials: view.initials,
      name: view.name,
      // As the vendor typed it on their profile ("Porto, Portugal").
      location: raw.orgs?.factory_profiles?.location ?? "",
      // The badge says TSC has checked this vendor, so only a verified one gets it.
      trust: raw.orgs?.factory_profiles?.verification_status === "verified"
        ? (raw.orgs?.factory_profiles?.trust_tier ?? "basic") : "",
      fit: "",
      response: "",
      fitType: fit?.label ?? "Potential fit",
      fitSummary: fit ? `${fit.score}% match to this request` : "Profile suitability for this request",
      factoryNote: view.notes,
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
        // Materials marked not included ("charged separately"), per unit
        // times the quantity; already in the quote total.
        additionalMaterialSubtotal: view.additionalMaterialSubtotal || "—",
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
      materialCosts: view.materialCosts,
      samples: [],
    };
  });

  return (
    <FlowShell screen="quotes" canBack onBack={() => navigate("/rfqs")} primaryLabel="">
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
