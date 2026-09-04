/**
 * Sending a quote.
 *
 * A genuine build, not a port: every field in the prototype's quote screen is
 * static display text with no input behind it, so there was nothing to wire up.
 *
 * Saves as you go, like every other flow here. Submission goes through
 * submit_quote(), which validates completeness and the verification gate in
 * one place and names the specific field that is missing rather than raising a
 * generic error.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getQuestions, getRfq } from "../../lib/domain/rfq.js";
import {
  createDraftQuote,
  getAnswers,
  getMyQuote,
  getSampleLines,
  reviseQuote,
  saveQuote,
  setAnswers,
  setSampleLines,
  submitQuote,
} from "../../lib/domain/quote.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatMoney, formatRange, fromCents, toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { TextArea, TextField } from "../onboarding/fields.jsx";
import "../onboarding/onboarding.css";
import "../rfq/rfq.css";
import "./quote.css";

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

export default function QuoteForm({ org, rfqId, profile }) {
  const { navigate } = useRouter();

  const [rfq, setRfq] = useState(null);
  const [quote, setQuote] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswerMap] = useState({});
  const [lines, setLines] = useState([]);
  const [terms, setTerms] = useState({});
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const setField = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const request = await getRfq(rfqId);
      if (!request) throw new Error("this request is not available to you");
      if (request.status !== "open") throw new Error("this request is no longer accepting quotes");

      const [byKind, qs, existing] = await Promise.all([
        listTermsByKind(["payment_term", "incoterm"]),
        getQuestions(rfqId),
        getMyQuote(rfqId, org.id),
      ]);

      // A draft exists before the first keystroke, same as the RFQ composer.
      let working = existing;
      if (!working) working = await createDraftQuote(rfqId, org.id);

      const [sampleRows, answerRows] = await Promise.all([
        getSampleLines(working.id),
        getAnswers(working.id),
      ]);

      if (cancelled) return;

      setRfq(request);
      setTerms(byKind);
      setQuestions(qs);
      setQuote(working);
      setLines(
        sampleRows.length
          ? sampleRows.map((row) => ({ ...row, cost: fromCents(row.cost_cents) }))
          : request.requires_sample
            ? [{ stage: "Fit sample", cost: "", timing_days: "", includes: "" }]
            : [],
      );
      setAnswerMap(
        Object.fromEntries(answerRows.map((row) => [row.question_id, row.answer_text ?? ""])),
      );
      setForm({
        unit_price: fromCents(working.unit_price_cents),
        production_quantity: working.production_quantity ?? request.quantity_total ?? "",
        bulk_lead_time_days: working.bulk_lead_time_days ?? "",
        capacity_window_start: working.capacity_window_start ?? "",
        capacity_window_end: working.capacity_window_end ?? "",
        capacity_window_units: working.capacity_window_units ?? "",
        payment_term: working.payment_term_id ?? "",
        deposit_pct: working.deposit_pct ?? "",
        incoterm: working.incoterm_id ?? "",
        shipping_notes: working.shipping_notes ?? "",
        valid_until: working.valid_until ?? "",
        factory_notes: working.factory_notes ?? "",
      });
    }

    boot().catch((failure) => {
      if (!cancelled) setLoadError(failure);
    });
    return () => {
      cancelled = true;
    };
  }, [rfqId, org.id]);

  const paymentTerms = terms.payment_term ?? [];
  const incoterms = terms.incoterm ?? [];

  /** Picking a template pre-fills the split; the stored number is what was agreed. */
  function choosePaymentTerm(termId) {
    const term = paymentTerms.find((entry) => entry.id === termId);
    const suggested = term?.extra?.default_deposit_pct;
    setForm((current) => ({
      ...current,
      payment_term: termId,
      deposit_pct: suggested != null ? String(suggested) : current.deposit_pct,
    }));
  }

  const patch = useCallback(
    () => ({
      unit_price_cents: toCents(form.unit_price),
      production_quantity: form.production_quantity ? Number(form.production_quantity) : null,
      bulk_lead_time_days: form.bulk_lead_time_days ? Number(form.bulk_lead_time_days) : null,
      capacity_window_start: form.capacity_window_start || null,
      capacity_window_end: form.capacity_window_end || null,
      capacity_window_units: form.capacity_window_units ? Number(form.capacity_window_units) : null,
      payment_term_id: form.payment_term || null,
      deposit_pct: form.deposit_pct === "" ? null : Number(form.deposit_pct),
      balance_pct: form.deposit_pct === "" ? null : 100 - Number(form.deposit_pct),
      incoterm_id: form.incoterm || null,
      shipping_notes: form.shipping_notes || null,
      valid_until: form.valid_until || null,
      factory_notes: form.factory_notes || null,
    }),
    [form],
  );

  async function persist() {
    const saved = await saveQuote(quote.id, patch());
    await setSampleLines(
      quote.id,
      lines.map((line) => ({ ...line, cost_cents: toCents(line.cost) })),
    );
    await setAnswers(quote.id, answers);
    setQuote(saved);
    return saved;
  }

  async function saveDraft() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await persist();
      navigate(`/browse/${rfqId}`);
    } catch (saveError) {
      setError(saveError);
      setSaving(false);
    }
  }

  async function send() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await persist();
      await submitQuote(quote.id);
      navigate(`/browse/${rfqId}/quote/sent`);
    } catch (sendError) {
      setError(sendError);
      setSaving(false);
    }
  }

  async function reopen() {
    setSaving(true);
    try {
      const draft = await reviseQuote(quote.id);
      setQuote(draft);
      setLines((await getSampleLines(draft.id)).map((row) => ({ ...row, cost: fromCents(row.cost_cents) })));
      setError(null);
    } catch (reviseError) {
      setError(reviseError);
    } finally {
      setSaving(false);
    }
  }

  const sampleTotalCents = useMemo(
    () => lines.reduce((sum, line) => sum + (toCents(line.cost) ?? 0), 0),
    [lines],
  );
  const productionCents = useMemo(() => {
    const price = toCents(form.unit_price);
    const qty = Number(form.production_quantity);
    return price != null && qty ? price * qty : null;
  }, [form.unit_price, form.production_quantity]);

  if (loadError) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate("/browse")}>← Back</button>
        <h1>Cannot quote this</h1>
        <p className="ob-error">{loadError.message}</p>
      </div>
    );
  }

  if (!rfq || !quote) {
    return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;
  }

  const isLocked = quote.status !== "draft";

  return (
    <div className="rfq-page quote-form">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/browse/${rfqId}`)}>
        ← Back to the request
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>Your quote</h1>
          <p>
            {rfq.title} · {rfq.quantity_total?.toLocaleString()} units · target{" "}
            {formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents)}
          </p>
        </div>
      </header>

      {isLocked ? (
        <div className="browse-gate">
          <strong>This quote is with the brand.</strong>
          <span>
            {quote.status === "submitted"
              ? "You can reopen it to change anything — the brand keeps seeing the current version, and the previous one is kept."
              : `This quote was ${quote.status}.`}
          </span>
          {quote.status === "submitted" ? (
            <button type="button" className="secondary-btn" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={reopen} disabled={saving}>
              Reopen to edit
            </button>
          ) : null}
        </div>
      ) : null}

      <fieldset className="quote-fieldset" disabled={isLocked}>
        <section className="detail-card">
          <h2>Commercial terms</h2>
          <p className="ob-hint">
            Quote the exact quantity asked for. Your MOQ belongs on your profile, not on a reply to
            a known order size.
          </p>

          <div className="ob-pair">
            <TextField label="Unit price" hint="USD per unit." value={form.unit_price}
              onChange={setField("unit_price")} inputMode="decimal" placeholder="18.40" />
            <TextField label="Production quantity" value={form.production_quantity}
              onChange={setField("production_quantity")} inputMode="numeric" />
          </div>

          <TextField label="Bulk lead time, days" hint="After sample approval."
            value={form.bulk_lead_time_days} onChange={setField("bulk_lead_time_days")} inputMode="numeric" placeholder="28" />

          <div className="ob-field" data-field="payment-terms">
            <span className="ob-label">Payment terms</span>
            <select value={form.payment_term ?? ""} onChange={(event) => choosePaymentTerm(event.target.value || null)}>
              <option value="">Select…</option>
              {paymentTerms.map((term) => (
                <option key={term.id} value={term.id}>{termLabel(term)}</option>
              ))}
            </select>
          </div>

          <TextField label="Deposit percent" hint="The balance is the remainder."
            value={form.deposit_pct} onChange={setField("deposit_pct")} inputMode="numeric" placeholder="30" />

          <div className="ob-field" data-field="shipping-terms">
            <span className="ob-label">Shipping terms</span>
            <select value={form.incoterm ?? ""} onChange={(event) => setField("incoterm")(event.target.value || null)}>
              <option value="">Select…</option>
              {incoterms.map((term) => (
                <option key={term.id} value={term.id}>{termLabel(term)}</option>
              ))}
            </select>
          </div>

          <TextField label="Shipping notes" value={form.shipping_notes} onChange={setField("shipping_notes")} />

          <TextField label="Quote valid until" type="date" hint="After this date the brand cannot award it."
            value={form.valid_until} onChange={setField("valid_until")} />
        </section>

        <section className="detail-card">
          <h2>Capacity window</h2>
          <p className="ob-hint">
            When you could actually run this. The brand needs it by{" "}
            {rfq.target_delivery_month ? MONTH.format(new Date(rfq.target_delivery_month)) : "a date they have not set"}.
          </p>
          <div className="ob-pair">
            <TextField label="From" type="date" value={form.capacity_window_start} onChange={setField("capacity_window_start")} />
            <TextField label="Until" type="date" value={form.capacity_window_end} onChange={setField("capacity_window_end")} />
            <TextField label="Units reserved" value={form.capacity_window_units}
              onChange={setField("capacity_window_units")} inputMode="numeric" />
          </div>
        </section>

        <section className="detail-card">
          <h2>Sample plan</h2>
          <p className="ob-hint">
            Break the stages out separately. It is the difference between a brand comparing your
            quote properly and guessing.
          </p>

          {lines.map((line, index) => (
            <div className="sample-row" key={index}>
              <input type="text" placeholder="Stage" value={line.stage}
                onChange={(e) => setLines((l) => l.map((x, i) => (i === index ? { ...x, stage: e.target.value } : x)))} />
              <input type="text" inputMode="decimal" placeholder="Cost" value={line.cost ?? ""}
                onChange={(e) => setLines((l) => l.map((x, i) => (i === index ? { ...x, cost: e.target.value } : x)))} />
              <input type="text" inputMode="numeric" placeholder="Days" value={line.timing_days ?? ""}
                onChange={(e) => setLines((l) => l.map((x, i) => (i === index ? { ...x, timing_days: e.target.value.replace(/[^0-9]/g, "") } : x)))} />
              <input type="text" placeholder="Includes" value={line.includes ?? ""}
                onChange={(e) => setLines((l) => l.map((x, i) => (i === index ? { ...x, includes: e.target.value } : x)))} />
              <button type="button" className="file-remove" onClick={() => setLines((l) => l.filter((_, i) => i !== index))}>
                Remove
              </button>
            </div>
          ))}

          <button type="button" className="secondary-btn" style={{ alignSelf: "flex-start" }}
            onClick={() => setLines((l) => [...l, { stage: "", cost: "", timing_days: "", includes: "" }])}>
            Add a sample stage
          </button>
        </section>

        {questions.length ? (
          <section className="detail-card">
            <h2>The brand's questions</h2>
            {questions.map((question) => (
              <div className="ob-field" key={question.id}>
                <span className="ob-label">
                  {question.prompt}
                  {question.is_sensitive ? <span className="private-tag">Private</span> : null}
                </span>
                <textarea
                  rows={3}
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswerMap((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              </div>
            ))}
            <p className="ob-hint">
              Anything not marked private is visible to the other factories quoting, so nobody has
              to ask the same thing twice.
            </p>
          </section>
        ) : null}

        <section className="detail-card">
          <h2>Notes for the brand</h2>
          <TextArea
            label="Assumptions, caveats, anything you need confirmed"
            value={form.factory_notes}
            onChange={setField("factory_notes")}
            rows={4}
          />
        </section>
      </fieldset>

      <section className="detail-card quote-total" data-testid="quote-total">
        <h2>What the brand sees</h2>
        <dl className="fact-row">
          <div className="fact">
            <dt>Production</dt>
            <dd data-testid="production-subtotal">{formatMoney(productionCents)}</dd>
          </div>
          <div className="fact">
            <dt>Samples</dt>
            <dd data-testid="sample-subtotal">{formatMoney(sampleTotalCents)}</dd>
          </div>
          <div className="fact">
            <dt>Total</dt>
            <dd data-testid="quote-total-amount">
              {productionCents == null ? "—" : formatMoney(productionCents + sampleTotalCents)}
            </dd>
          </div>
        </dl>
        <p className="ob-hint">
          Totals are worked out from what you entered, so they can never disagree with the lines
          above.
        </p>
      </section>

      {error ? <p className="ob-error">{error.message}</p> : null}

      {!isLocked ? (
        <footer className="ob-actions quote-actions">
          <button type="button" className="quiet-btn" onClick={saveDraft} disabled={saving}>
            Save and finish later
          </button>
          <button type="button" className="primary-btn" onClick={send} disabled={saving}>
            {saving ? "Sending…" : "Send quote"}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
