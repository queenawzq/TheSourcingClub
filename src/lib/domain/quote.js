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
  unit_price_cents, unit_price_max_cents, currency, production_quantity,
  bulk_lead_time_days, bulk_lead_time_max_days,
  capacity_window_start, capacity_window_end, capacity_window_units,
  payment_term_id, deposit_pct, balance_pct,
  incoterm_id, shipping_notes, valid_until, factory_notes, sourcing_includes, factory_response,
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

/**
 * One transaction: accept the winner, decline the rest, notify everyone.
 * The delivery term is the brand/factory agreement reached after the quote,
 * so it may intentionally differ from the factory's original quote.
 */
export async function awardQuote(quoteId, agreedIncotermId) {
  return unwrap(
    await supabase.rpc("award_quote_with_incoterm", {
      target_quote: quoteId,
      agreed_incoterm: agreedIncotermId,
    }),
    "award this quote",
  );
}

// ---- Sample plan ----------------------------------------------------------

export async function getSampleLines(quoteId) {
  return unwrap(
    await supabase
      .from("quote_sample_lines")
      .select("id, stage, cost_cents, timing_days, timing_max_days, includes, sort")
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
      timing_max_days: line.timing_max_days ? Number(line.timing_max_days) : null,
      includes: line.includes || null,
      sort: index,
    }));

  if (!rows.length) return [];
  return unwrap(
    await supabase.from("quote_sample_lines").insert(rows).select(),
    "save the sample plan",
  );
}

// ---- Material cost breakdown ---------------------------------------------

export async function getMaterialLines(quoteId) {
  return unwrap(
    await supabase
      .from("quote_material_lines")
      .select("id, material, cost_cents, included, sort")
      .eq("quote_id", quoteId)
      .order("sort"),
    "load the material cost breakdown",
  );
}

export async function setMaterialLines(quoteId, lines) {
  unwrap(
    await supabase.from("quote_material_lines").delete().eq("quote_id", quoteId),
    "clear the material cost breakdown",
  );

  const rows = lines
    .filter((line) => line.material?.trim())
    .map((line, index) => ({
      quote_id: quoteId,
      material: line.material.trim(),
      cost_cents: line.cost_cents == null ? null : Number(line.cost_cents),
      included: Boolean(line.included),
      sort: index,
    }));

  if (!rows.length) return [];
  return unwrap(
    await supabase.from("quote_material_lines").insert(rows).select(),
    "save the material cost breakdown",
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
 * Every live quote on a request, for the brand's comparison table. Staff
 * pass `statuses` to read the revised and withdrawn ones their list shows too.
 *
 * The partial unique indexes guarantee at most one submitted quote per factory
 * per request, so filtering on status IS "the latest per factory" — there is
 * no is_latest flag to drift, and no need to fetch every version and filter in
 * JavaScript.
 */
export async function listQuotesForRfq(rfqId, { statuses = ["submitted", "accepted", "declined"] } = {}) {
  const quotes = unwrap(
    await supabase
      .from("quotes")
      .select(`${QUOTE_COLUMNS}, orgs!quotes_factory_org_id_fkey (id, name, slug, factory_profiles (verification_status, trust_tier, location))`)
      .eq("rfq_id", rfqId)
      .in("status", statuses)
      .order("unit_price_cents", { ascending: true }),
    "load the quotes",
  );

  if (!quotes.length) return [];

  const ids = quotes.map((quote) => quote.id);

  const [lines, materials, answers, subtotals] = await Promise.all([
    unwrap(
      await supabase
        .from("quote_sample_lines")
        .select("quote_id, stage, cost_cents, timing_days, timing_max_days, includes, sort")
        .in("quote_id", ids)
        .order("sort"),
      "load sample plans",
    ),
    unwrap(
      await supabase
        .from("quote_material_lines")
        .select("quote_id, material, cost_cents, included, sort")
        .in("quote_id", ids)
        .order("sort"),
      "load material cost breakdowns",
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

  return quotes.map((quote) => {
    const sampleLines = lines.filter((line) => line.quote_id === quote.id);
    const materialLines = materials.filter((line) => line.quote_id === quote.id);
    return {
      ...quote,
      sampleLines,
      materialLines,
      answers: answers.filter((answer) => answer.quote_id === quote.id),
      // Derived, never stored: the prototype hardcodes a sample subtotal per
      // factory name while displaying the very lines that should produce it.
      ...quoteSubtotals(quote, { materialLines, sampleSubtotalCents: subtotalByQuote[quote.id] ?? 0 }),
    };
  });
}

/**
 * Per unit, what the material lines marked not included add on top of the
 * unit price. The form tells the vendor "Costs marked not included are added
 * on top of the quoted unit price", so they are part of what the brand pays.
 * USD only, like the lines themselves (their check constraint).
 *
 * Must stay identical to quote_additional_material_per_unit() in
 * supabase/migrations/20261022000400_quote_fixes.sql, which the order created
 * at award uses: a brand must not be shown one total and charged another.
 */
export function additionalMaterialPerUnitCents(materialLines = []) {
  return (materialLines ?? []).reduce(
    (total, line) => total + (line.included ? 0 : Number(line.cost_cents) || 0),
    0,
  );
}

/**
 * The figures every quote screen prints, derived from the quote and its
 * lines. `sampleSubtotalCents` may be passed (the database's own sum);
 * otherwise the sample lines are added up.
 */
export function quoteSubtotals(quote, { sampleLines = [], materialLines = [], sampleSubtotalCents } = {}) {
  const quantity = quote?.production_quantity;
  const priced = quote?.unit_price_cents != null && quantity != null;
  const additionalPerUnit = additionalMaterialPerUnitCents(materialLines);
  return {
    sampleSubtotalCents: sampleSubtotalCents
      ?? (sampleLines ?? []).reduce((total, line) => total + (Number(line.cost_cents) || 0), 0),
    productionSubtotalCents: priced ? quote.unit_price_cents * quantity : null,
    productionSubtotalMaxCents: priced ? (quote.unit_price_max_cents ?? quote.unit_price_cents) * quantity : null,
    additionalMaterialPerUnitCents: additionalPerUnit,
    additionalMaterialSubtotalCents: quantity == null ? null : additionalPerUnit * quantity,
  };
}

/**
 * Quote total = production + samples + materials charged separately.
 * Computed, so it cannot contradict its parts. The order made at award totals
 * the same (create_order_from_award), at the low end of a price range.
 */
export function quoteTotalCents(quote) {
  if (quote.productionSubtotalCents == null) return null;
  return quote.productionSubtotalCents
    + (quote.sampleSubtotalCents ?? 0)
    + (quote.additionalMaterialSubtotalCents ?? 0);
}

/** The same total at the top of a quoted price range. */
export function quoteTotalMaxCents(quote) {
  const production = quote.productionSubtotalMaxCents ?? quote.productionSubtotalCents;
  if (production == null) return null;
  return production + (quote.sampleSubtotalCents ?? 0) + (quote.additionalMaterialSubtotalCents ?? 0);
}

/** A stored lower/upper duration rendered as "7–10 days", "7 days" or "1 day". */
export function formatDayRange(minimum, maximum = minimum) {
  if (minimum == null) return "";
  const min = Number(minimum);
  const max = maximum == null ? min : Number(maximum);
  if (min === max) return `${min} ${min === 1 ? "day" : "days"}`;
  return `${Math.min(min, max)}–${Math.max(min, max)} days`;
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
 * The capacity window, typed however the vendor writes dates: see
 * capacity-window.mjs, which a check script runs without the database.
 */
export { capacityWindowProblem, formatCapacityWindow, parseCapacityWindow } from "./capacity-window.mjs";
