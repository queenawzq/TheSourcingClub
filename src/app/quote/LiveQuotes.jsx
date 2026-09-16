/**
 * Comparing quotes, on Queena's designed screen.
 *
 * `QuotesScreen` and `FlowShell` come from src/prototype/main.jsx. This file
 * is the seam.
 *
 * Choosing a quote awards it, and awarding creates the production order in the
 * same transaction with a snapshot of the quote's commercial terms. The design
 * walks to a separate "contract" card first; live there is nothing to agree
 * there that award_quote does not already record, so choosing goes straight
 * to the order it creates.
 */
import React, { useCallback, useEffect, useState } from "react";
import { FlowShell, QuotesScreen } from "../../prototype/main.jsx";
import { awardQuote, listQuotesForRfq, quoteTotalCents } from "../../lib/domain/quote.js";
import { formatMoney } from "../../lib/money.js";

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

export default function LiveQuotes({ rfqId, onAwarded }) {
  const [quotes, setQuotes] = useState(null);
  const [selected, setSelected] = useState(null);
  const [compare, setCompare] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setQuotes(await listQuotesForRfq(rfqId));
    } catch (failure) {
      setError(failure);
    }
  }, [rfqId]);

  useEffect(() => { reload(); }, [reload]);

  async function award(quoteId) {
    setBusy(true);
    setError(null);
    try {
      await awardQuote(quoteId);
      onAwarded?.(quoteId);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!quotes) return null;

  if (!quotes.length) {
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
  const shaped = quotes.map((quote) => {
    const total = quoteTotalCents(quote);
    const name = quote.orgs?.name ?? quote.factory_name ?? "Vendor";
    return {
      id: quote.id,
      initials: initialsOf(name),
      name,
      location: "",
      trust: "trusted",
      fit: "",
      response: "",
      fitType: `Version ${quote.version}`,
      fitSummary: quote.factory_notes ?? "",
      factoryNote: quote.shipping_notes ?? "",
      price: quote.unit_price_cents == null ? "—" : formatMoney(quote.unit_price_cents, quote.currency),
      quoteQuantity: quote.production_quantity ? `${quote.production_quantity} units` : "—",
      lead: quote.bulk_lead_time_days ? `${quote.bulk_lead_time_days} days` : "—",
      total: total == null ? "—" : formatMoney(total, quote.currency),
      stats: [
        ["Unit price", quote.unit_price_cents == null ? "—" : formatMoney(quote.unit_price_cents, quote.currency)],
        ["Quantity", quote.production_quantity ? String(quote.production_quantity) : "—"],
        ["Bulk lead time", quote.bulk_lead_time_days ? `${quote.bulk_lead_time_days} days` : "—"],
        ["Total", total == null ? "—" : formatMoney(total, quote.currency)],
      ],
      products: [],
      categories: [],
      capabilities: [],
      notes: quote.factory_notes ? [quote.factory_notes] : [],
      materialCosts: [],
      samples: [],
    };
  });

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
        onAward={award}
        busy={busy}
        error={error}
      />
    </FlowShell>
  );
}
