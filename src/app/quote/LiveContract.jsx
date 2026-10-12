/**
 * The contract step: the terms about to be agreed, read back, then award.
 *
 * `ContractScreen` is Queena's "Confirm final terms" card. Live it has nothing
 * to write — award_quote takes no terms, and create_order_from_award snapshots
 * the quote's own in the same transaction — so every field here is read-only.
 * What it adds is the moment the design asks for: seeing exactly what is being
 * committed to before committing, instead of one click on a card doing it.
 *
 * Awarding is owner-only in the database; a member is told so here rather
 * than refused after clicking.
 */
import React, { useState } from "react";
import { ContractScreen, FlowShell } from "../../prototype/main.jsx";
import { awardQuote, orderForQuote } from "../../lib/domain/quote.js";
import { urlFor } from "../../lib/domain/documents.js";
import { openRfqThread } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import { useQuoteReview } from "./useQuoteReview.js";

export default function LiveContract({ rfqId, quoteId, isOwner }) {
  const { navigate } = useRouter();
  const { state, error: loadError } = useQuoteReview(rfqId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (loadError) return <FlowShell screen="contract" canBack={false} primaryLabel=""><p className="composer-error" role="alert">{loadError.message}</p></FlowShell>;
  if (!state) return null;

  const found = state.quotes.find(({ raw }) => raw.id === quoteId);
  const back = () => navigate(`/rfqs/${rfqId}/quotes/${quoteId}`);

  // Why this quote cannot be awarded now, if it cannot. Said up front; the
  // database refuses the same cases regardless.
  const blocked = !found
    ? "This quote is no longer live — the vendor may have revised or withdrawn it."
    : state.rfq.status !== "open"
      ? `This request is ${state.rfq.status}, so no quote on it can be chosen.`
      : found.raw.status !== "submitted"
        ? `This quote was ${found.raw.status}.`
        : !isOwner
          ? "Only an owner of your company can choose a quote, because choosing creates the production order."
          : null;

  async function award() {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await awardQuote(quoteId);
      const order = await orderForQuote(quoteId);
      navigate(order?.id ? `/orders/${order.id}` : "/orders");
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  async function message() {
    try {
      const thread = await openRfqThread(rfqId, found.raw.factory_org_id);
      navigate(`/messages/${thread.id}`);
    } catch (failure) {
      setError(failure);
    }
  }

  async function open(file) {
    try {
      window.open(await urlFor(file), "_blank", "noopener");
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <FlowShell
      screen="contract"
      canBack
      onBack={back}
      onNext={award}
      busy={busy}
      primaryLabel={blocked ? "" : busy ? "Creating the order…" : "Confirm and create order"}
      rail={found ? {
        vendor: {
          initials: found.view.initials,
          name: found.view.name,
          location: found.raw.orgs?.factory_profiles?.location ?? "",
          onMessage: message,
        },
      } : null}
    >
      {blocked && <p className="composer-error" role="status" data-testid="contract-blocked">{blocked}</p>}
      {found && (
        <ContractScreen
          terms={{ ...found.view, title: state.request.title, brief: state.request.brief }}
          attachments={state.files}
          onOpenAttachment={open}
        />
      )}
      {error && <p className="composer-error" role="alert">{error.message}</p>}
    </FlowShell>
  );
}
