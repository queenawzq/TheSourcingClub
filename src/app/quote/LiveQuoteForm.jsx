/**
 * Submitting a quote, on Queena's designed screen.
 *
 * `FactorySubmitQuote` comes from src/factory-prototype/main.jsx. This file is
 * the seam.
 *
 * The design writes its quote as prose — "30% deposit / 70% before shipment",
 * "EXW quoted; shipping TBD" — where the schema keeps taxonomy ids, because a
 * brand compares quotes on those terms and cannot compare sentences. So the
 * typed value is MATCHED against the vocabulary rather than parsed into it:
 * a payment split by its numbers, an incoterm by its three-letter code.
 *
 * Nothing is guessed. A value that matches no term stores nothing, and
 * `submit_quote()` then refuses and names the field it is missing — which the
 * screen shows. That is the honest failure: better a factory is told which
 * term it needs than a quote is stored against one nobody chose.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { initials } from "../order/order-view.js";
import { quoteTextPatch, quoteTextValues } from "./quote-text-fields.js";
import { FactorySubmitQuote } from "../../factory-prototype/main.jsx";
import {
  createDraftQuote,
  formatCapacityWindow,
  formatDayRange,
  getLatestQuote,
  getMaterialLines,
  getSampleLines,
  capacityWindowProblem,
  parseCapacityWindow,
  saveQuote,
  setMaterialLines,
  setSampleLines,
  submitQuote,
} from "../../lib/domain/quote.js";
import { brandSummary, getColourSplits, getQuestions, getRfq, matchScoresForRfq } from "../../lib/domain/rfq.js";
import { downloadDocuments, getRfqDocumentPresentation } from "../../lib/domain/documents.js";
import { listLinks, listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatRange, toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { sourcingChoiceLabel } from "../rfq/resume-fields.js";
import { getRequestOrigin, withRequestOrigin } from "../rfq/request-origin.js";
import { getUiLanguage } from "../../lib/ui-language.js";
import { useChineseContent } from "../content-translation.js";
import { fetchApi } from "../../lib/supabase.js";
import { acceptModelWindow, windowNeedsReading, windowUnits } from "../../lib/domain/capacity-window.mjs";
import { requestQuantity, requestSamples } from "../rfq/request-facts.js";

const KINDS = ["payment_term", "incoterm", "sourcing_responsibility", "certification", "service"];

const firstNumber = (text) => {
  const match = String(text ?? "").match(/\d[\d,]*(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
};

/**
 * "$18.40–$21.00 / unit" → 18.40 to 21.00; "28 days" → 28 to 28.
 *
 * Only the first number, or the first two written as a range ("a–b", "a-b",
 * "a to b"), counts: any other number is something else ("$18.40 for 300
 * units", "10 days incl. 1 revision round"). With `days`, a figure given in
 * weeks ("4-6 weeks") is converted, since the field stores days.
 */
function priceRange(text, { days = false } = {}) {
  const said = String(text ?? "");
  const number = "(\\d[\\d,]*(?:\\.\\d+)?)";
  const match = said.match(new RegExp(`${number}(?:(?:\\s*[-–—]\\s*|\\s+to\\s+)(?:US)?\\$?\\s*${number})?`, "i"));
  if (!match) return { min: null, max: null };
  const first = Number(match[1].replace(/,/g, ""));
  const second = match[2] == null ? first : Number(match[2].replace(/,/g, ""));
  const scale = days && /^\s*(?:weeks?\b|wks?\b|周|週|星期|个星期|個星期)/i.test(said.slice(match.index + match[0].length)) ? 7 : 1;
  // Days are stored whole.
  const value = (amount) => (days ? Math.round(amount * scale) : amount);
  return { min: value(Math.min(first, second)), max: value(Math.max(first, second)) };
}

/** "30% deposit / 70% before shipment" → the deposit-30-70 term. */
function paymentTermFrom(terms, typed) {
  const text = String(typed ?? "").toLowerCase();
  const split = text.match(/\b(\d{1,3})\s*%?\s*(?:\/|-|and)\s*(\d{1,3})\s*%?\b/);
  if (split && Number(split[1]) + Number(split[2]) === 100) {
    const slug = `deposit-${Number(split[1])}-${Number(split[2])}`;
    const hit = terms.find((term) => term.slug === slug);
    if (hit) return hit;
  }
  const deposit = text.match(/(\d{2})\s*%/);
  if (deposit) {
    const slug = `deposit-${deposit[1]}-${100 - Number(deposit[1])}`;
    const hit = terms.find((term) => term.slug === slug);
    if (hit) return hit;
  }
  if (/paid in full/.test(text)) return terms.find((term) => term.slug === "paid-in-full");
  if (/net\s*30/.test(text)) return terms.find((term) => term.slug === "net-30");
  return null;
}

/** "EXW quoted; shipping TBD" → the EXW term. */
function incotermFrom(terms, typed) {
  const text = String(typed ?? "").toUpperCase();
  return terms.find((term) => new RegExp(`\\b${term.slug.toUpperCase()}\\b`).test(text))
    // "free on board" as well as "FOB": the term's name is its label after the code.
    ?? terms.find((term) => {
      const name = String(term.label_en ?? "").split(/[—–-]/).slice(1).join(" ").trim().toUpperCase();
      return name && text.replace(/\s+/g, " ").includes(name);
    })
    ?? null;
}

/** The deposit percentage the payment term implies, for the schedule generator. */
function depositPctFrom(slug) {
  const match = String(slug ?? "").match(/^deposit-(\d+)-(\d+)$/);
  if (match) return Number(match[1]);
  if (slug === "paid-in-full") return 100;
  if (slug === "net-30") return 0;
  return null;
}

/** "2 months" has no fixed number of days, and read as a figure it stored 2 days. */
const IN_MONTHS = /\d\s*(?:months?\b|mos?\b|个月|個月)/i;

const WINDOW_EXAMPLE = "“Dec 1 - Jan 15”";

/**
 * The sentence for a window that cannot be kept: the field, what to fix, and
 * an example. Any readable dates are kept, so this is only for text that is
 * not dates, or dates that are not real or already over.
 */
function windowRefusal(values, companyType) {
  const problem = capacityWindowProblem(values.capacityWindow);
  if (!problem) return null;
  const field = companyType === "trading" ? "partner production window" : "open capacity window";
  switch (problem.code) {
    case "past":
      return problem.yearWritten
        ? `${field} (those dates have passed; check the dates, like ${WINDOW_EXAMPLE})`
        : `${field} (those dates have passed; add the year, like “Jan 15, ${new Date().getFullYear() + 1}”)`;
    case "long":
      return `${field} (can't be longer than 12 months; check the dates, like ${WINDOW_EXAMPLE})`;
    case "order":
      return `${field} (the first date is after the last; check the dates, like ${WINDOW_EXAMPLE})`;
    case "invalid":
      return `${field} (“${problem.piece}” is not a date; check the day and month, like ${WINDOW_EXAMPLE})`;
    case "words":
      return `${field} (remove the extra words, like ${WINDOW_EXAMPLE})`;
    case "many":
      return `${field} (enter a first and last date, like ${WINDOW_EXAMPLE})`;
    default:
      return `${field} (enter dates, like ${WINDOW_EXAMPLE})`;
  }
}

/**
 * A window the parser could not read (no readable dates, or words beside
 * them), read by the server's model (api/parse-capacity-window.js) and kept
 * only when it passes the same rules. The field then holds the reading, so
 * Review, the draft and the stored dates all come from it, and the vendor can
 * still change it. Any failure leaves the values as typed, and the form says
 * what it says without the model.
 */
async function withWindowReading(values) {
  const typed = String(values.capacityWindow ?? "").trim();
  if (!typed || !windowNeedsReading(capacityWindowProblem(typed))) return values;
  let answer = null;
  try {
    const response = await fetchApi("/api/parse-capacity-window", {
      text: typed,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const body = response.ok ? await response.json().catch(() => ({})) : {};
    answer = acceptModelWindow(body?.window);
  } catch {
    answer = null;
  }
  if (!answer) return values;
  const reading = formatCapacityWindow({
    capacity_window_start: answer.start,
    capacity_window_end: answer.end,
    capacity_window_units: windowUnits(typed),
  });
  if (capacityWindowProblem(reading)) return values;
  // Typed over while the reading was on its way: what is there now wins, and
  // is read by the form's own rules like any other text.
  const field = document.querySelector('[data-quote-field="capacityWindow"]');
  const now = field ? field.textContent.trim() : typed;
  if (now !== typed) return { ...values, capacityWindow: now };
  showWindowReading(reading);
  return { ...values, capacityWindow: reading };
}

/** The reading into the field as an edit, so the browser's undo brings the vendor's own words back. */
function showWindowReading(reading) {
  const field = document.querySelector('[data-quote-field="capacityWindow"]');
  if (!field) return;
  let replaced = false;
  try {
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    replaced = document.execCommand("insertText", false, reading);
    selection.removeAllRanges();
    field.blur();
  } catch {
    replaced = false;
  }
  if (!replaced || field.textContent.trim() !== reading) field.textContent = reading;
}

function missingQuoteFields(values, terms, companyType) {
  const missing = [];
  if (!(firstNumber(values.unitPrice) > 0)) missing.push("unit price");
  if (!(firstNumber(values.quantity) > 0)) missing.push("production quantity");
  if (!(firstNumber(values.leadTime) > 0)) missing.push("bulk lead time");
  else if (IN_MONTHS.test(values.leadTime)) missing.push("bulk lead time (write days or weeks, like “30-35 days”)");
  const refusal = windowRefusal(values, companyType);
  if (refusal) missing.push(refusal);
  const paymentTerms = String(values.paymentTerms ?? "").trim();
  if (!paymentTerms) {
    missing.push("payment terms");
  } else if (!paymentTermFrom(terms.payment_term ?? [], paymentTerms)) {
    missing.push("payment terms (try “30/70”, “paid in full”, or “Net 30”)");
  }
  if (!incotermFrom(terms.incoterm ?? [], values.incoterms)) missing.push("shipping terms (try EXW, FOB or DDP)");
  const validUntil = String(values.validUntil ?? "").trim();
  // The same test the database makes, on the same day: submit_quote() and
  // award_quote() refuse a valid_until before current_date, which is the UTC
  // date (the database runs in UTC). Compared with the vendor's local date,
  // a date this check passed could be refused on sending (west of UTC in the
  // evening), or one the database accepts refused here (east of UTC in the
  // morning).
  const todayInDatabase = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < todayInDatabase) missing.push("quote valid until");
  // Not required, but read the same way as the lead time.
  for (const key of Object.keys(values)) {
    if (/^sample\.\d+\.timing$/.test(key) && IN_MONTHS.test(values[key] ?? "")) {
      missing.push(`${values[`sample.${key.split(".")[1]}.stage`]?.trim() || "sample"} timing (write days or weeks, like “10-14 days”)`);
    }
  }
  return missing;
}

export default function LiveQuoteForm({ org, rfqId, profile }) {
  useChineseContent({ rfqIds: [rfqId] });
  const { navigate } = useRouter();
  const requestOrigin = getRequestOrigin();
  const requestPath = withRequestOrigin(`/browse/${rfqId}`, requestOrigin);
  const reviewPath = withRequestOrigin(`/browse/${rfqId}/quote/review`, requestOrigin);
  const [rfq, setRfq] = useState(null);
  const [quote, setQuote] = useState(null);
  const [lines, setLines] = useState([]);
  const [materialLines, setMaterialLinesState] = useState([]);
  const [terms, setTerms] = useState({});
  const [questions, setQuestions] = useState([]);
  const [matchScore, setMatchScore] = useState(null);
  const [requestDocuments, setRequestDocuments] = useState({ files: [], images: [] });
  const [certificationTags, setCertificationTags] = useState([]);
  const [serviceTags, setServiceTags] = useState([]);
  const [busy, setBusy] = useState(false);
  // True while a Review press that asked for a window reading is waiting on
  // it and on the save after it: the button then says "Saving…", since
  // nothing is sent at this step.
  const [readingWindow, setReadingWindow] = useState(false);
  const [error, setError] = useState(null);
  const [colourSplits, setColourSplits] = useState([]);
  const [draftState, setDraftState] = useState(null);

  const kinds = useMemo(() => KINDS, []);

  const load = useCallback(async () => {
    try {
      const [request, vocab, asked, scores, documents, linkedTermIds, splits] = await Promise.all([
        getRfq(rfqId),
        listTermsByKind(kinds),
        getQuestions(rfqId),
        matchScoresForRfq(rfqId, [org.id]).catch(() => new Map()),
        getRfqDocumentPresentation(rfqId).catch(() => ({ files: [], images: [] })),
        listLinks("rfq", rfqId),
        getColourSplits(rfqId).catch(() => []),
      ]);
      setColourSplits(splits ?? []);
      const brand = request.brand_org_id ? await brandSummary(request.brand_org_id).catch(() => null) : null;
      setRfq({ ...request, paymentVerified: Boolean(brand?.payment_verified) });
      setTerms(vocab);
      setQuestions(asked ?? []);
      setMatchScore(scores.get(org.id) ?? null);
      setRequestDocuments(documents);
      setCertificationTags(
        (vocab.certification ?? [])
          .filter((term) => linkedTermIds.includes(term.id))
          .map((term) => termLabel(term)),
      );
      setServiceTags(
        (vocab.service ?? [])
          .filter((term) => linkedTermIds.includes(term.id))
          .map((term) => termLabel(term)),
      );

      // A draft is started only when this vendor has no quote here at all.
      // Anything else — sent, decided, withdrawn — is not editable, and the
      // form used to open on it anyway: a sent quote failed to save, and a
      // withdrawn one silently started a fresh draft. Those go to the
      // read-back, where editing a sent quote asks first.
      const latest = await getLatestQuote(rfqId, org.id);
      if (latest && latest.status !== "draft") {
        navigate(requestPath);
        return;
      }
      const mine = latest ?? (await createDraftQuote(rfqId, org.id));
      const [savedSampleLines, savedMaterialLines] = await Promise.all([
        getSampleLines(mine.id),
        getMaterialLines(mine.id),
      ]);
      setLines(savedSampleLines ?? []);
      setMaterialLinesState(savedMaterialLines ?? []);
      // Publish the quote only after all child rows are ready. Material rows
      // are stateful editable controls, so mounting the form before this data
      // arrives would initialize them as empty and discard the loaded rows.
      setQuote(mine);
    } catch (failure) {
      setError(failure);
    }
  }, [rfqId, org.id, kinds, navigate, requestPath]);

  useEffect(() => { load(); }, [load]);

  /** Write what is on the card to the draft. */
  async function persist(values) {
    const unit = priceRange(values.unitPrice);
    const lead = priceRange(values.leadTime, { days: true });
    const payment = paymentTermFrom(terms.payment_term ?? [], values.paymentTerms);
    const incoterm = incotermFrom(terms.incoterm ?? [], values.incoterms);
    const depositPct = depositPctFrom(payment?.slug);

    await saveQuote(quote.id, {
      ...quoteTextPatch(values),
      unit_price_cents: unit.min == null ? null : toCents(unit.min),
      unit_price_max_cents: unit.max == null ? null : toCents(unit.max),
      production_quantity: firstNumber(values.quantity),
      bulk_lead_time_days: lead.min,
      bulk_lead_time_max_days: lead.max,
      payment_term_id: payment?.id ?? null,
      incoterm_id: incoterm?.id ?? null,
      shipping_notes: values.incoterms?.trim() || null,
      // The window the vendor typed, as far as it parses. Nothing was written
      // here before, so reopening a draft lost it and Review showed it blank.
      ...parseCapacityWindow(values.capacityWindow),
      // deposit_pct is nullable and submit_quote does not require it, but an
      // order generated from a quote without one gets milestones totalling
      // only the sample lines, agree_schedule refuses that forever, and the
      // order is dead with nothing on screen explaining why.
      deposit_pct: depositPct,
      balance_pct: depositPct == null ? null : 100 - depositPct,
      valid_until: (() => {
        const entered = String(values.validUntil ?? "").trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(entered) ? entered : null;
      })(),
    });

    // Each designed sample stage becomes a row; the quote total is computed
    // from them rather than typed.
    const stages = Object.keys(values)
      .filter((key) => /^sample\.\d+\.stage$/.test(key))
      .map((key) => Number(key.split(".")[1]))
      .sort((a, b) => a - b)
      .map((index) => ({
        stage: values[`sample.${index}.stage`]?.trim(),
        cost_cents: (() => {
          const amount = firstNumber(values[`sample.${index}.cost`]);
          return amount == null ? null : toCents(amount);
        })(),
        timing_days: priceRange(values[`sample.${index}.timing`], { days: true }).min,
        timing_max_days: priceRange(values[`sample.${index}.timing`], { days: true }).max,
        includes: values[`sample.${index}.includes`]?.trim() || null,
        sort: index,
      }))
      .filter((row) => row.stage && row.cost_cents != null);
    await setSampleLines(quote.id, stages);

    await setMaterialLines(quote.id, (values.materialCosts ?? []).map((line) => ({
      material: line.material,
      cost_cents: line.costPerUnit == null ? null : toCents(line.costPerUnit),
      included: line.included,
    })));
  }

  /**
   * Save what is on the card, then go to the design's Review step.
   *
   * The flow is four screens — details, prepare, review, sent — and review is
   * where the vendor sees the computed total and what sending costs before it
   * is charged. Submitting straight from the form skipped both.
   */
  async function saveAndReview(typedValues) {
    // Not while Save draft is still saving (or still waiting on a reading).
    if (busy || !quote || draftState === "saving") return;
    const companyType = profile?.vendor_kind === "trading_company" ? "trading" : "factory";
    // Other fields first: no reading is asked for while the form is
    // incomplete anyway, and the list is the same as without one.
    const windowSentence = windowRefusal(typedValues, companyType);
    const before = missingQuoteFields(typedValues, terms, companyType);
    if (before.some((item) => item !== windowSentence)) {
      setError(new Error(`Complete these required fields before reviewing: ${before.join(", ")}.`));
      return;
    }
    setBusy(true);
    // "Saving…" for the whole press when a reading is asked for: the save
    // that follows it sends nothing either, and the label should not flip.
    setReadingWindow(Boolean(String(typedValues.capacityWindow ?? "").trim())
      && windowNeedsReading(capacityWindowProblem(typedValues.capacityWindow)));
    const values = await withWindowReading(typedValues);
    const missing = missingQuoteFields(values, terms, companyType);
    if (missing.length) {
      setError(new Error(`Complete these required fields before reviewing: ${missing.join(", ")}.`));
      setReadingWindow(false);
      setBusy(false);
      return;
    }
    setError(null);

    try {
      await persist(values);
      navigate(reviewPath);
    } catch (failure) {
      setError(failure);
    } finally {
      setReadingWindow(false);
      setBusy(false);
    }
  }

  /** The design's "Save draft": keep the card and stay on it. */
  async function saveDraft(typedValues) {
    if (busy || !quote || draftState === "saving") return;
    setDraftState("saving");
    setError(null);
    const values = await withWindowReading(typedValues);
    try {
      await persist(values);
      setDraftState("saved");
      // Saved, but the window stays only on this screen: say so rather than
      // have it vanish when the draft is reopened.
      if (String(values.capacityWindow ?? "").trim()) {
        const refusal = windowRefusal(values, profile?.vendor_kind === "trading_company" ? "trading" : "factory");
        if (refusal) setError(new Error(`Draft saved, except this field, which was not kept: ${refusal}.`));
      }
    } catch (failure) {
      setError(failure);
      setDraftState(null);
    }
  }

  if (!rfq || !quote) return null;

  const money = (cents) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);
  // No fit label to a factory about itself (Nov 7), as on RFQ details.
  const fit = null;
  const selectedSourcing = (terms.sourcing_responsibility ?? []).find(
    (term) => term.id === rfq.sourcing_responsibility_term_id,
  );

  async function downloadRequestFiles() {
    try {
      await downloadDocuments(requestDocuments.files);
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <FactorySubmitQuote
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      language={getUiLanguage()}
      busyLabel={readingWindow ? (getUiLanguage() === "zh" ? "保存中…" : "Saving…") : null}
      project={{
        title: rfq.title || "Request",
        brand: rfq.orgs?.name ?? "",
        quantity: requestQuantity(rfq.quantity_total, colourSplits),
        specialty: rfq.brief ?? "",
        images: requestDocuments.images,
        tags: [],
        certifications: certificationTags,
        services: serviceTags,
        files: requestDocuments.files.map((file) => file.file_name),
        onDownloadFiles: downloadRequestFiles,
        capacity: fit ? [fit.label] : [],
        initials: initials(rfq.orgs?.name),
        budget: formatRange(
          rfq.target_unit_price_min_cents,
          rfq.target_unit_price_max_cents,
          rfq.currency,
        ),
        samples: requestSamples(rfq),
        quoteDue: "",
        fitTone: fit?.tone ?? "",
        // Absent, the card prints "undefined" beside the brand name.
        location: "",
        posted: "",
        paymentVerified: rfq.paymentVerified,
        trust: "",
      }}
      values={{
        ...quoteTextValues(quote),
        brandQuestions: questions.map((question) => question.prompt),
        brandSourcing: {
          material: rfq.material_notes ?? "",
          responsibility: sourcingChoiceLabel(selectedSourcing),
          details: rfq.sourcing_details ?? "",
          services: serviceTags.join(", "),
        },
        brandAdditionalDetails: rfq.additional_details ?? "",
        materialCosts: materialLines.map((line) => ({
          id: line.id,
          material: line.material,
          costPerUnit: line.cost_cents == null ? null : line.cost_cents / 100,
          included: line.included,
        })),
        unitPrice: quote.unit_price_cents
          ? `${formatRange(quote.unit_price_cents, quote.unit_price_max_cents ?? quote.unit_price_cents, quote.currency)} / unit`
          : "",
        quantity: quote.production_quantity
          ? `${quote.production_quantity} units`
          : rfq.quantity_total
            ? `${rfq.quantity_total} units`
            : "",
        leadTime: formatDayRange(quote.bulk_lead_time_days, quote.bulk_lead_time_max_days),
        // Every field the vendor has not filled is blank, never the design's
        // example: readQuote() submits whatever these hold. What it HAS filled
        // comes back, or reopening a draft silently drops it.
        capacityWindow: formatCapacityWindow(quote),
        paymentTerms: quote.deposit_pct
          ? `${Number(quote.deposit_pct)}% deposit / ${Number(quote.balance_pct ?? 100 - quote.deposit_pct)}% before shipment`
          : "",
        incoterms: quote.shipping_notes ?? "",
        validUntil: quote.valid_until ?? "",
        ...Object.fromEntries(lines.flatMap((line, index) => [
          [`sample.${index}.stage`, line.stage ?? ""],
          [`sample.${index}.cost`, money(line.cost_cents)],
          [`sample.${index}.timing`, formatDayRange(line.timing_days, line.timing_max_days)],
          [`sample.${index}.includes`, line.includes ?? ""],
        ])),
      }}
      onBack={() => navigate(requestPath)}
      onReviewTotal={saveAndReview}
      onSaveDraft={saveDraft}
      draftState={draftState}
      busy={busy}
      error={error}
    />
  );
}
