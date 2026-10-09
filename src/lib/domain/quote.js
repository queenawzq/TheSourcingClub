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

/**
 * The factory's latest quote on a request, withdrawn included.
 *
 * getMyQuote() skips a withdrawn row, which is right for the brand-facing
 * reads but wrong for the vendor's own screens: a withdrawal is final, so the
 * vendor has to see it, not a blank form that silently starts a new quote.
 */
export async function getLatestQuote(rfqId, factoryOrgId) {
  return unwrap(
    await supabase
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("rfq_id", rfqId)
      .eq("factory_org_id", factoryOrgId)
      .neq("status", "superseded")
      .order("version", { ascending: false })
      .order("created_at", { ascending: false })
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
      .select(`${QUOTE_COLUMNS}, orgs!quotes_factory_org_id_fkey (id, name, slug, factory_profiles (verification_status))`)
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

/**
 * The production order an accepted quote became.
 *
 * award_quote creates it in the same transaction, so this always resolves
 * after a successful award — but it is written to tolerate null rather than
 * assume, since a caller looking up a quote that lost would get nothing.
 */
export async function orderForQuote(quoteId) {
  return unwrap(
    await supabase
      .from("production_orders")
      .select("id, order_number")
      .eq("quote_id", quoteId)
      .maybeSingle(),
    "find the production order",
  );
}

/**
 * The designed quote form writes the capacity window as prose — "Oct 15 - Nov
 * 20 · 300 units" — where the schema keeps two dates and a count. Same rule as
 * the payment split and the incoterm: what parses is stored, and what does not
 * stores nothing rather than a guess.
 */
export function parseCapacityWindow(text, now = new Date()) {
  const said = String(text ?? "").trim();
  if (!said) return { capacity_window_start: null, capacity_window_end: null, capacity_window_units: null };

  // Two dates, in whatever order the vendor wrote them, with the year assumed
  // to be the coming one when it is left off.
  const dates = (said.match(/(?:\d{4}-\d{2}-\d{2})|(?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,\s*\d{4})?)|(?:\d{1,2}\s+[A-Za-z]{3,9}(?:,?\s*\d{4})?)/g) ?? [])
    .map((piece) => {
      const withYear = /\d{4}/.test(piece) ? piece : `${piece}, ${now.getFullYear()}`;
      const at = Date.parse(withYear);
      return Number.isNaN(at) ? null : new Date(at);
    })
    .filter(Boolean)
    .sort((a, b) => a - b);

  // A units figure, but never one of the numbers already claimed by a date.
  const units = said.match(/(\d[\d,]*)\s*(?:units?|pcs|pieces)/i);

  return {
    capacity_window_start: dates[0] ? dates[0].toISOString().slice(0, 10) : null,
    capacity_window_end: dates[1] ? dates[1].toISOString().slice(0, 10) : null,
    capacity_window_units: units ? Number(units[1].replace(/,/g, "")) : null,
  };
}

/** The same window read back as the sentence the vendor typed. */
export function formatCapacityWindow(quote) {
  if (!quote) return "";
  const day = (value) => (value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" })
    : "");
  const span = [day(quote.capacity_window_start), day(quote.capacity_window_end)].filter(Boolean).join(" - ");
  const units = quote.capacity_window_units ? `${quote.capacity_window_units} units` : "";
  return [span, units].filter(Boolean).join(" · ");
}
