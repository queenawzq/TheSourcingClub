/**
 * One vendor's quote in full, on Queena's designed `QuoteDetailScreen`.
 *
 * Every figure is the stored quote read through describeQuote(); sections the
 * vendor left empty (material costs, a sample plan it did not give) are left
 * out rather than filled from the prototype's example vendor.
 */
import React, { useState } from "react";
import { FlowShell, QuoteDetailScreen } from "../../prototype/main.jsx";
import { openRfqThread } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import { useQuoteReview } from "./useQuoteReview.js";

export default function LiveQuoteDetail({ rfqId, quoteId }) {
  const { navigate } = useRouter();
  const { state, error: loadError } = useQuoteReview(rfqId);
  const [error, setError] = useState(null);

  if (loadError) return <FlowShell screen="quoteDetail" canBack={false} primaryLabel=""><p className="composer-error" role="alert">{loadError.message}</p></FlowShell>;
  if (!state) return null;

  const found = state.quotes.find(({ raw }) => raw.id === quoteId);
  if (!found) {
    return (
      <FlowShell screen="quoteDetail" canBack onBack={() => navigate(`/rfqs/${rfqId}/quotes`)} primaryLabel="">
        <p className="projects-empty">This quote is no longer live — the vendor may have revised or withdrawn it.</p>
      </FlowShell>
    );
  }

  async function message() {
    setError(null);
    try {
      const thread = await openRfqThread(rfqId, found.raw.factory_org_id);
      navigate(`/messages/${thread.id}`);
    } catch (failure) {
      setError(failure);
    }
  }

  const toContract = () => navigate(`/rfqs/${rfqId}/quotes/${quoteId}/contract`);

  return (
    <FlowShell
      screen="quoteDetail"
      canBack
      onBack={() => navigate(`/rfqs/${rfqId}/quotes`)}
      onNext={toContract}
      primaryLabel="Choose quote"
    >
      <QuoteDetailScreen
        quote={{ ...found.view, fitType: `Version ${found.view.version}` }}
        request={state.request}
        onBack={() => navigate(`/rfqs/${rfqId}/quotes`)}
        onMessage={message}
        onChoose={toContract}
      />
      {error && <p className="composer-error" role="alert">{error.message}</p>}
    </FlowShell>
  );
}
