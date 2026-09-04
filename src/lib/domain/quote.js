/**
 * Quotes.
 *
 * Versioned: revising writes a new row that supersedes the old one, so a price
 * that moved after a conversation leaves a trace. Every status transition goes
 * through an RPC — the RLS policy only permits editing a draft, so a factory
 * cannot mark its own quote submitted, let alone accepted.
 */
import { supabase, unwrap } from "../supabase.js";

const QUOTE_COLUMNS = `
  id, rfq_id, factory_org_id, version, supersedes_quote_id, status,
  unit_price_cents, currency, production_quantity, bulk_lead_time_days,
  capacity_window_start, capacity_window_end, capacity_window_units,
  payment_term_id, deposit_pct, balance_pct,
  incoterm_id, shipping_notes, valid_until, factory_notes,
  submitted_at, decided_at, created_at, updated_at
`;

/**
 * The factory's current quote on a request, if any.
 *
 * "Current" means the live one: a draft being written, or the submitted row.
 * Superseded and withdrawn versions stay in the table as history and are not
 * what the form should open.
 */
export async function getMyQuote(rfqId, factoryOrgId) {
  return unwrap(
    await supabase
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("rfq_id", rfqId)
      .eq("factory_org_id", factoryOrgId)
      .in("status", ["draft", "submitted", "accepted", "declined"])
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "load your quote",
  );
}

export async function createDraftQuote(rfqId, factoryOrgId) {
  return unwrap(
    await supabase
      .from("quotes")
      .insert({ rfq_id: rfqId, factory_org_id: factoryOrgId })
      .select(QUOTE_COLUMNS)
      .single(),
    "start a quote",
  );
}

export async function saveQuote(quoteId, patch) {
  return unwrap(
    await supabase.from("quotes").update(patch).eq("id", quoteId).select(QUOTE_COLUMNS).single(),
    "save your quote",
  );
}

/** Validation and the verification gate both live in the RPC, not here. */
export async function submitQuote(quoteId) {
  return unwrap(await supabase.rpc("submit_quote", { quote_id: quoteId }), "send your quote");
}

export async function reviseQuote(quoteId) {
  return unwrap(await supabase.rpc("revise_quote", { quote_id: quoteId }), "reopen your quote");
}

export async function withdrawQuote(quoteId) {
  return unwrap(await supabase.rpc("withdraw_quote", { quote_id: quoteId }), "withdraw your quote");
}

/** One transaction: accept the winner, decline the rest, notify everyone. */
export async function awardQuote(quoteId) {
  return unwrap(await supabase.rpc("award_quote", { quote_id: quoteId }), "award this quote");
}

// ---- Sample plan ----------------------------------------------------------

export async function getSampleLines(quoteId) {
  return unwrap(
    await supabase
      .from("quote_sample_lines")
      .select("id, stage, cost_cents, timing_days, includes, sort")
      .eq("quote_id", quoteId)
      .order("sort"),
    "load the sample plan",
  );
}

export async function setSampleLines(quoteId, lines) {
  unwrap(
    await supabase.from("quote_sample_lines").delete().eq("quote_id", quoteId),
    "clear the sample plan",
  );

  const rows = lines
    .filter((line) => line.stage?.trim())
    .map((line, index) => ({
      quote_id: quoteId,
      stage: line.stage.trim(),
      cost_cents: Number(line.cost_cents) || 0,
      timing_days: line.timing_days ? Number(line.timing_days) : null,
      includes: line.includes || null,
      sort: index,
    }));

  if (!rows.length) return [];
  return unwrap(
    await supabase.from("quote_sample_lines").insert(rows).select(),
    "save the sample plan",
  );
}

// ---- Answers --------------------------------------------------------------

export async function getAnswers(quoteId) {
  return unwrap(
    await supabase
      .from("quote_question_answers")
      .select("id, question_id, answer_text")
      .eq("quote_id", quoteId),
    "load your answers",
  );
}

export async function setAnswers(quoteId, answers) {
  const rows = Object.entries(answers)
    .filter(([, text]) => text?.trim())
    .map(([questionId, text]) => ({
      quote_id: quoteId,
      question_id: questionId,
      answer_text: text.trim(),
    }));

  if (!rows.length) return [];
  return unwrap(
    await supabase
      .from("quote_question_answers")
      .upsert(rows, { onConflict: "quote_id,question_id" })
      .select(),
    "save your answers",
  );
}

// ---- Comparison -----------------------------------------------------------

/**
 * Every live quote on a request, for the brand's comparison table.
 *
 * The partial unique indexes guarantee at most one submitted quote per factory
 * per request, so filtering on status IS "the latest per factory" — there is
 * no is_latest flag to drift, and no need to fetch every version and filter in
 * JavaScript.
 */
export async function listQuotesForRfq(rfqId) {
  const quotes = unwrap(
    await supabase
      .from("quotes")
      .select(`${QUOTE_COLUMNS}, orgs!quotes_factory_org_id_fkey (id, name, slug)`)
      .eq("rfq_id", rfqId)
      .in("status", ["submitted", "accepted", "declined"])
      .order("unit_price_cents", { ascending: true }),
    "load the quotes",
  );

  if (!quotes.length) return [];

  const ids = quotes.map((quote) => quote.id);

  const [lines, answers, subtotals] = await Promise.all([
    unwrap(
      await supabase
        .from("quote_sample_lines")
        .select("quote_id, stage, cost_cents, timing_days, includes, sort")
        .in("quote_id", ids)
        .order("sort"),
      "load sample plans",
    ),
    unwrap(
      await supabase
        .from("quote_question_answers")
        .select("quote_id, question_id, answer_text")
        .in("quote_id", ids),
      "load answers",
    ),
    Promise.all(
      ids.map(async (id) => {
        const { data } = await supabase.rpc("quote_sample_subtotal", { target_quote: id });
        return [id, data ?? 0];
      }),
    ),
  ]);

  const subtotalByQuote = Object.fromEntries(subtotals);

  return quotes.map((quote) => ({
    ...quote,
    sampleLines: lines.filter((line) => line.quote_id === quote.id),
    answers: answers.filter((answer) => answer.quote_id === quote.id),
    // Derived, never stored: the prototype hardcodes a sample subtotal per
    // factory name while displaying the very lines that should produce it.
    sampleSubtotalCents: subtotalByQuote[quote.id] ?? 0,
    productionSubtotalCents:
      quote.unit_price_cents != null && quote.production_quantity != null
        ? quote.unit_price_cents * quote.production_quantity
        : null,
  }));
}

/** Quote total = production + samples. Computed, so it cannot contradict its parts. */
export function quoteTotalCents(quote) {
  if (quote.productionSubtotalCents == null) return null;
  return quote.productionSubtotalCents + (quote.sampleSubtotalCents ?? 0);
}
