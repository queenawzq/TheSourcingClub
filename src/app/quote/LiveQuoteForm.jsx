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
import { FactorySubmitQuote } from "../../factory-prototype/main.jsx";
import {
  createDraftQuote,
  formatCapacityWindow,
  formatDayRange,
  getLatestQuote,
  getMaterialLines,
  getSampleLines,
  parseCapacityWindow,
  saveQuote,
  setMaterialLines,
  setSampleLines,
  submitQuote,
} from "../../lib/domain/quote.js";
import { getQuestions, getRfq, matchScoresForRfq } from "../../lib/domain/rfq.js";
import { downloadDocuments, getRfqDocumentPresentation } from "../../lib/domain/documents.js";
import { listLinks, listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatRange, toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { matchFit } from "../rfq/match-fit.js";
import { sourcingChoiceLabel } from "../rfq/resume-fields.js";
import { getRequestOrigin, withRequestOrigin } from "../rfq/request-origin.js";

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
  const scale = days && /^\s*(?:weeks?|wks?)\b/i.test(said.slice(match.index + match[0].length)) ? 7 : 1;
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
  return terms.find((term) => new RegExp(`\\b${term.slug.toUpperCase()}\\b`).test(text)) ?? null;
}

/** The deposit percentage the payment term implies, for the schedule generator. */
function depositPctFrom(slug) {
  const match = String(slug ?? "").match(/^deposit-(\d+)-(\d+)$/);
  if (match) return Number(match[1]);
  if (slug === "paid-in-full") return 100;
  if (slug === "net-30") return 0;
  return null;
}

function missingQuoteFields(values, terms) {
  const missing = [];
  if (!(firstNumber(values.unitPrice) > 0)) missing.push("unit price");
  if (!(firstNumber(values.quantity) > 0)) missing.push("production quantity");
  if (!(firstNumber(values.leadTime) > 0)) missing.push("bulk lead time");
  if (!String(values.capacityWindow ?? "").trim()) missing.push("open capacity window");
  const paymentTerms = String(values.paymentTerms ?? "").trim();
  if (!paymentTerms) {
    missing.push("payment terms");
  } else if (!paymentTermFrom(terms.payment_term ?? [], paymentTerms)) {
    missing.push("payment terms (try “30/70”, “paid in full”, or “Net 30”)");
  }
  if (!incotermFrom(terms.incoterm ?? [], values.incoterms)) missing.push("shipping terms");
  const validUntil = String(values.validUntil ?? "").trim();
  // The same test the database makes, on the same day: submit_quote() and
  // award_quote() refuse a valid_until before current_date, which is the UTC
  // date (the database runs in UTC). Compared with the vendor's local date,
  // a date this check passed could be refused on sending (west of UTC in the
  // evening), or one the database accepts refused here (east of UTC in the
  // morning).
  const todayInDatabase = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < todayInDatabase) missing.push("quote valid until");
  return missing;
}

export default function LiveQuoteForm({ org, rfqId, profile }) {
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
  const [error, setError] = useState(null);
  const [draftState, setDraftState] = useState(null);

  const kinds = useMemo(() => KINDS, []);

  const load = useCallback(async () => {
    try {
      const [request, vocab, asked, scores, documents, linkedTermIds] = await Promise.all([
        getRfq(rfqId),
        listTermsByKind(kinds),
        getQuestions(rfqId),
        matchScoresForRfq(rfqId, [org.id]).catch(() => new Map()),
        getRfqDocumentPresentation(rfqId).catch(() => ({ files: [], images: [] })),
        listLinks("rfq", rfqId),
      ]);
      setRfq(request);
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
    const stages = [0, 1]
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
    if (stages.length) await setSampleLines(quote.id, stages);

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
  async function saveAndReview(values) {
    if (busy || !quote) return;
    const missing = missingQuoteFields(values, terms);
    if (missing.length) {
      setError(new Error(`Complete these required fields before reviewing: ${missing.join(", ")}.`));
      return;
    }
    setBusy(true);
    setError(null);

    try {
      await persist(values);
      navigate(reviewPath);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  /** The design's "Save draft": keep the card and stay on it. */
  async function saveDraft(values) {
    if (busy || !quote || draftState === "saving") return;
    setDraftState("saving");
    setError(null);
    try {
      await persist(values);
      setDraftState("saved");
    } catch (failure) {
      setError(failure);
      setDraftState(null);
    }
  }

  if (!rfq || !quote) return null;

  const money = (cents) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);
  const line = (index) => lines[index];
  const fit = matchFit(matchScore);
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
      language="en"
      project={{
        title: rfq.title || "Request",
        brand: rfq.orgs?.name ?? "",
        quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
        specialty: rfq.brief ?? "",
        images: requestDocuments.images,
        tags: [],
        certifications: certificationTags,
        services: serviceTags,
        files: requestDocuments.files.map((file) => file.file_name),
        onDownloadFiles: downloadRequestFiles,
        capacity: fit ? [fit.label] : [],
        initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
        budget: formatRange(
          rfq.target_unit_price_min_cents,
          rfq.target_unit_price_max_cents,
          rfq.currency,
        ),
        samples: rfq.requires_sample ? "Sample required" : "No sample",
        quoteDue: "",
        fitTone: fit?.tone ?? "",
        // Absent, the card prints "undefined" beside the brand name.
        location: "",
        posted: "",
        paymentVerified: false,
        trust: "",
      }}
      values={{
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
        "sample.0.stage": line(0)?.stage ?? "",
        "sample.0.cost": line(0) ? money(line(0).cost_cents) : "",
        "sample.0.timing": formatDayRange(line(0)?.timing_days, line(0)?.timing_max_days),
        "sample.0.includes": line(0)?.includes ?? "",
        "sample.1.stage": line(1)?.stage ?? "",
        "sample.1.cost": line(1) ? money(line(1).cost_cents) : "",
        "sample.1.timing": formatDayRange(line(1)?.timing_days, line(1)?.timing_max_days),
        "sample.1.includes": line(1)?.includes ?? "",
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
