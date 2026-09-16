/**
 * The factory's own requests — the ones it was invited to or has quoted on —
 * on Queena's designed screen.
 *
 * `FactoryRfqsPage` comes from src/factory-prototype/main.jsx. This file is the
 * seam. The design's four tabs map onto rows the database already has:
 *
 *   Active   a submitted quote on a request that is still open
 *   Drafts   a quote the factory started and has not sent
 *   Invited  an invitation with no quote against it yet
 *   Closed   the request was awarded or cancelled, or the quote was decided
 *
 * "Payment verified" and fit badges are drawn on every mock card; nothing
 * verifies a brand's payment ahead of an order, so the live cards go without.
 */
import React, { useEffect, useState } from "react";
import { FactoryRfqsPage } from "../../factory-prototype/main.jsx";
import { listFactoryRfqs } from "../../lib/domain/rfq.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

const STATUS = {
  draft: ["Draft", "warning"],
  submitted: ["Quote submitted", "success"],
  accepted: ["Awarded", "success"],
  declined: ["Not selected", "neutral"],
  withdrawn: ["Withdrawn", "neutral"],
  invited: ["Invited", "info"],
};

/** One request, in the shape the designed card reads. */
function toCard(rfq, quote) {
  const statusKey = quote?.status ?? "invited";
  const [status, statusTone] = STATUS[statusKey] ?? STATUS.invited;
  const quoted = quote?.unit_price_cents != null ? `${formatMoney(quote.unit_price_cents, quote.currency)} / unit` : "Not quoted";

  return {
    id: rfq.id,
    quoteStatus: statusKey,
    initials: initialsOf(rfq.orgs?.name),
    title: rfq.title || "Untitled request",
    brand: rfq.orgs?.name ?? "A brand",
    location: rfq.published_at ? `Posted ${DAY.format(new Date(rfq.published_at))}` : "",
    trust: "",
    tags: [
      rfq.quantity_total ? `${rfq.quantity_total.toLocaleString()} units` : null,
      formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency),
      rfq.requires_sample ? "Sample before bulk" : null,
    ].filter((tag) => tag && tag !== "—"),
    images: [],
    facts: [
      ["Quantity", rfq.quantity_total ? `${rfq.quantity_total.toLocaleString()} units` : "—"],
      ["Samples", rfq.requires_sample ? "Sample required" : "No sample"],
    ],
    metrics: [
      [quoted],
      [rfq.quote_deadline ? DAY.format(new Date(rfq.quote_deadline)) : "—", "Quote due"],
    ],
    status,
    statusTone,
    description: rfq.brief ?? rfq.material_notes ?? "",
  };
}

export default function LiveFactoryRfqs({ org }) {
  const { navigate } = useRouter();
  const [tabs, setTabs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listFactoryRfqs(org.id)
      .then(({ quotes, invitations }) => {
        if (cancelled) return;
        const closedRfq = (rfq) => rfq.status === "awarded" || rfq.status === "cancelled";
        const quotedRfqIds = new Set(quotes.map((quote) => quote.rfq_id));
        const byTab = { active: [], drafts: [], invited: [], closed: [] };

        for (const quote of quotes) {
          const card = toCard(quote.rfqs, quote);
          if (closedRfq(quote.rfqs) || ["accepted", "declined", "withdrawn"].includes(quote.status)) byTab.closed.push(card);
          else if (quote.status === "draft") byTab.drafts.push(card);
          else byTab.active.push(card);
        }
        for (const invitation of invitations) {
          if (quotedRfqIds.has(invitation.rfq_id) || !invitation.rfqs) continue;
          (closedRfq(invitation.rfqs) ? byTab.closed : byTab.invited).push(toCard(invitation.rfqs, null));
        }
        setTabs(byTab);
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  if (error) return <main className="rfqs-page factory-rfqs-page"><p className="composer-error" role="alert">{error.message}</p></main>;
  if (!tabs) return null;

  return (
    <FactoryRfqsPage
      language="en"
      rfqsByTab={tabs}
      onBrowseRfqs={() => navigate("/browse")}
      // A sent quote opens read-only; anything else opens the quote form.
      onViewRequest={(rfq) => navigate(rfq?.id ? `/browse/${rfq.id}/quote/sent` : "/browse")}
      onEditQuote={(rfq) => navigate(rfq?.id ? (rfq.quoteStatus === "invited" ? `/browse/${rfq.id}` : `/browse/${rfq.id}/quote`) : "/browse")}
    />
  );
}
