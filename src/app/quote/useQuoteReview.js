/**
 * What the brand's quote screens read: the request, its live quotes, and the
 * few lookups that turn stored ids into words.
 *
 * The quotes list, one quote in full and the contract step all show the same
 * request and the same figures, so they load them the same way.
 */
import { useCallback, useEffect, useState } from "react";
import { getColourSplits, getQuestions, getRfq } from "../../lib/domain/rfq.js";
import { listQuotesForRfq } from "../../lib/domain/quote.js";
import { listRfqDocuments } from "../../lib/domain/documents.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatRange } from "../../lib/money.js";
import { describeQuote } from "./quote-view.js";

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

/** The request as the "Original request" card and the rail print it. */
export function describeRequest(rfq, { colours = [], sourcingTerms = [] } = {}) {
  if (!rfq) return null;
  const colourLine = colours.length
    ? `${colours.length} ${colours.length === 1 ? "color" : "colors"} · ${colours.map((split) => `${split.colour} ${split.quantity}`).join(", ")}`
    : "";
  const sourcing = sourcingTerms.find((term) => term.id === rfq.sourcing_responsibility_term_id);
  return {
    title: rfq.title ?? "",
    brief: rfq.brief ?? "",
    product: rfq.title ?? "",
    colours: colourLine,
    quantity: [rfq.quantity_total ? `${rfq.quantity_total} units` : "", colours.length ? `${colours.length} colors` : ""]
      .filter(Boolean).join(" · "),
    target: rfq.target_unit_price_min_cents != null
      ? `${formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency)} / unit`
      : "",
    samples: rfq.sample_notes?.trim() || (rfq.requires_sample ? "Sample required" : ""),
    targetDate: rfq.target_delivery_month ? `Delivery by ${MONTH.format(new Date(rfq.target_delivery_month))}` : "",
    sourcing: sourcing ? termLabel(sourcing) : "",
    materials: rfq.material_notes ?? "",
  };
}

export function useQuoteReview(rfqId) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [rfq, quotes, colours, questions, files, terms] = await Promise.all([
        getRfq(rfqId),
        listQuotesForRfq(rfqId),
        getColourSplits(rfqId),
        getQuestions(rfqId),
        listRfqDocuments(rfqId).catch(() => []),
        listTermsByKind(["incoterm", "sourcing_responsibility"]),
      ]);
      if (!rfq) throw new Error("this request is not available to you");

      const prompts = Object.fromEntries((questions ?? []).map((question) => [question.id, question.prompt]));
      const described = quotes.map((quote) => ({
        raw: quote,
        view: {
          ...describeQuote(quote, { incoterms: terms.incoterm ?? [] }),
          answers: (quote.answers ?? [])
            .filter((answer) => answer.answer_text?.trim())
            .map((answer) => ({ question: prompts[answer.question_id] ?? "Question", answer: answer.answer_text })),
        },
      }));

      setState({
        rfq,
        request: describeRequest(rfq, { colours, sourcingTerms: terms.sourcing_responsibility ?? [] }),
        quotes: described,
        files: files ?? [],
      });
    } catch (failure) {
      setError(failure);
    }
  }, [rfqId]);

  useEffect(() => { load(); }, [load]);

  return { state, error, reload: load };
}
