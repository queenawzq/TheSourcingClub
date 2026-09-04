/**
 * Writing a request for quotes.
 *
 * Same per-step persistence as onboarding: each step saves as it completes, so
 * closing the tab loses nothing and reopening resumes where it stopped. The
 * one structural difference is that a draft row is created on entry, because
 * an org has many RFQs and the free-text brief is worth saving from the first
 * keystroke.
 *
 * Publishing is deliberately its own action on the last step, not a side
 * effect of pressing Continue.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listTermsByKind, setLinks } from "../../lib/domain/taxonomy.js";
import { getSelectedTerms } from "../../lib/domain/profile.js";
import {
  attachDocumentToRfq,
  createDraftRfq,
  getColourSplits,
  getQuestions,
  getRfq,
  publishRfq,
  rfqGaps,
  saveRfq,
  setColourSplits,
  setQuestions,
} from "../../lib/domain/rfq.js";
import { deleteDocument, listDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { fromCents, toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { ChipGroup, TermSelect, TextArea, TextField, UploadField } from "../onboarding/fields.jsx";
import "../onboarding/onboarding.css";
import "./rfq.css";

const KINDS = ["product_category", "region", "certification", "sourcing_responsibility"];

const STEPS = [
  { key: "describe",  title: "What do you need made?", blurb: "In your own words. We will structure it on the next step." },
  { key: "specifics", title: "Quantity and materials",  blurb: "The numbers a factory needs before it can price anything." },
  { key: "timeline",  title: "Timeline and budget",     blurb: "When you need it, and roughly what you expect to pay." },
  { key: "questions", title: "Questions for factories", blurb: "Answers come back with every quote, so you can compare like for like." },
  { key: "review",    title: "Review and publish",      blurb: "Who should see this request." },
];

/** The rolling window the delivery-month picker offers. */
function deliveryMonths(count = 9) {
  const start = new Date();
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 1, 1));
    return {
      value: month.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(month),
    };
  });
}

export default function RfqCreate({ org, rfqId: existingId }) {
  const { navigate } = useRouter();

  const [rfqId, setRfqId] = useState(existingId ?? null);
  const [terms, setTerms] = useState(null);
  const [rfq, setRfq] = useState(null);
  const [selected, setSelected] = useState({});
  const [documents, setDocuments] = useState([]);
  const [colours, setColours] = useState([{ colour: "", quantity: "" }]);
  const [questions, setQuestionList] = useState([]);
  const [visibility, setVisibility] = useState("open_to_all");

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({});

  const setField = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const setTermIds = (kind) => (ids) => setSelected((current) => ({ ...current, [kind]: ids }));

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const termsByKind = await listTermsByKind(KINDS);
      // A draft exists before the first keystroke, so nothing typed is ever
      // held only in component state.
      const draft = existingId ? await getRfq(existingId) : await createDraftRfq(org.id);
      if (!draft) throw new Error("that request no longer exists");

      const [links, docs, splits, qs] = await Promise.all([
        getSelectedTerms("rfq", draft.id),
        listDocuments(org.id),
        getColourSplits(draft.id),
        getQuestions(draft.id),
      ]);

      if (cancelled) return;

      if (!existingId) navigate(`/rfqs/${draft.id}/edit`, { replace: true });

      setRfqId(draft.id);
      setTerms(termsByKind);
      setRfq(draft);
      setSelected(links);
      setDocuments(docs.filter((doc) => doc.rfq_id === draft.id));
      setColours(splits.length ? splits : [{ colour: "", quantity: "" }]);
      setQuestionList(qs);
      setVisibility(draft.visibility ?? "open_to_all");
      setForm({
        title: draft.title ?? "",
        brief: draft.brief ?? "",
        quantity_total: draft.quantity_total ?? "",
        material_notes: draft.material_notes ?? "",
        sourcing: draft.sourcing_responsibility_term_id ?? "",
        target_delivery_month: draft.target_delivery_month ?? "",
        sample_notes: draft.sample_notes ?? "",
        requires_sample: draft.requires_sample ?? true,
        price_min: fromCents(draft.target_unit_price_min_cents),
        price_max: fromCents(draft.target_unit_price_max_cents),
        quote_deadline: draft.quote_deadline ? draft.quote_deadline.slice(0, 10) : "",
        additional_details: draft.additional_details ?? "",
      });

      const gaps = rfqGaps(draft, links, qs);
      const firstGap = gaps.findIndex((gap) => !gap.done);
      if (existingId && firstGap > 0) setStep(Math.min(firstGap, STEPS.length - 1));
    }

    boot().catch((failure) => {
      if (!cancelled) setLoadError(failure);
    });

    return () => {
      cancelled = true;
    };
  }, [org.id, existingId]);

  const refreshDocuments = useCallback(async () => {
    const docs = await listDocuments(org.id);
    setDocuments(docs.filter((doc) => doc.rfq_id === rfqId));
  }, [org.id, rfqId]);

  async function handleUpload(kind, file) {
    const doc = await uploadDocument({ orgId: org.id, kind, file });
    // Scope it to this request, so a brand with three open requests is not
    // offered every tech pack it has ever uploaded on each of them.
    await attachDocumentToRfq(doc.id, rfqId);
    await refreshDocuments();
  }

  async function saveStep() {
    const key = STEPS[step].key;
    const patch = {};
    const linkKinds = [];

    if (key === "describe") {
      patch.title = form.title?.trim() || "Untitled request";
      patch.brief = form.brief || null;
      linkKinds.push("product_category");
    }

    if (key === "specifics") {
      Object.assign(patch, {
        quantity_total: form.quantity_total ? Number(form.quantity_total) : null,
        material_notes: form.material_notes || null,
        sourcing_responsibility_term_id: form.sourcing || null,
      });
      linkKinds.push("certification");
      await setColourSplits(rfqId, colours);
    }

    if (key === "timeline") {
      Object.assign(patch, {
        target_delivery_month: form.target_delivery_month || null,
        requires_sample: Boolean(form.requires_sample),
        sample_notes: form.sample_notes || null,
        target_unit_price_min_cents: toCents(form.price_min),
        target_unit_price_max_cents: toCents(form.price_max),
        quote_deadline: form.quote_deadline ? new Date(form.quote_deadline).toISOString() : null,
      });
      linkKinds.push("region");
    }

    if (key === "questions") {
      patch.additional_details = form.additional_details || null;
      await setQuestions(rfqId, questions);
    }

    if (Object.keys(patch).length) setRfq(await saveRfq(rfqId, patch));

    for (const kind of linkKinds) {
      await setLinks({
        subjectType: "rfq",
        subjectId: rfqId,
        orgId: org.id,
        kind,
        termIds: selected[kind] ?? [],
      });
    }
  }

  async function next() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveStep();
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveStep();
      await publishRfq(rfqId, visibility);
      // An invite-only request nobody has been invited to is invisible, so go
      // straight to choosing who sees it rather than leaving it stranded.
      navigate(visibility === "invited_only" ? `/rfqs/${rfqId}/invite` : `/rfqs/${rfqId}`);
    } catch (publishError) {
      setError(publishError);
      setSaving(false);
    }
  }

  const gaps = useMemo(() => rfqGaps(rfq, selected, questions), [rfq, selected, questions]);
  const months = useMemo(() => deliveryMonths(), []);

  if (loadError) {
    return (
      <div className="ob-shell">
        <div className="ob-panel">
          <h1>Could not open this request</h1>
          <p className="ob-error">{loadError.message}</p>
        </div>
      </div>
    );
  }

  if (!terms || !rfq) {
    return (
      <div className="ob-shell">
        <div className="ob-panel">
          <div className="spinner" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const current = STEPS[step];
  const isLast = current.key === "review";

  return (
    <div className="ob-shell">
      <aside className="ob-rail">
        <p className="ob-rail-head">New request</p>
        <ol className="ob-steps">
          {STEPS.map((entry, index) => (
            <li key={entry.key} className={index === step ? "is-current" : index < step ? "is-done" : undefined}>
              <span className="ob-step-num">{index < step ? "✓" : index + 1}</span>
              <button type="button" onClick={() => index < step && setStep(index)} disabled={index > step}>
                {entry.title}
              </button>
            </li>
          ))}
        </ol>
        <p className="ob-hint" style={{ marginTop: 24 }}>
          Saved as you go. You can close this and come back.
        </p>
      </aside>

      <main className="ob-main">
        <header className="ob-head">
          <p className="ob-eyebrow">Step {step + 1} of {STEPS.length}</p>
          <h1>{current.title}</h1>
          <p className="ob-blurb">{current.blurb}</p>
        </header>

        <div className="ob-body">
          {current.key === "describe" ? (
            <>
              <TextField
                label="Give it a name"
                hint="Only you and the factories you invite see this."
                value={form.title}
                onChange={setField("title")}
                placeholder="Organic cotton woven shirts, autumn"
              />
              <TextArea
                label="Describe what you need made"
                hint="Plain language is fine. Fabric, construction, fit, anything a factory would ask about."
                value={form.brief}
                onChange={setField("brief")}
                rows={7}
              />
              <ChipGroup
                label="Product category"
                kind="product_category"
                terms={terms.product_category ?? []}
                selectedIds={selected.product_category ?? []}
                onChange={setTermIds("product_category")}
                orgId={org.id}
              />
              <UploadField
                label="Tech pack, sketches or references"
                hint="Anything that saves a factory guessing. Visible to factories you invite."
                accept="application/pdf,image/png,image/jpeg,image/webp"
                existing={documents.filter((doc) => doc.kind === "tech_pack")}
                onUpload={(file) => handleUpload("tech_pack", file)}
                onRemove={async (doc) => {
                  await deleteDocument(doc);
                  await refreshDocuments();
                }}
              />
            </>
          ) : null}

          {current.key === "specifics" ? (
            <>
              <TextField
                label="Total quantity"
                hint="Across every colour and size."
                value={form.quantity_total}
                onChange={setField("quantity_total")}
                inputMode="numeric"
                placeholder="300"
              />

              <div className="ob-field" data-field="colour-breakdown">
                <span className="ob-label">Colour breakdown</span>
                <span className="ob-hint ob-hint--above">
                  Optional, but it changes the price — dye lots have minimums of their own.
                </span>
                {colours.map((split, index) => (
                  <div className="ob-pair" key={index}>
                    <input
                      type="text"
                      placeholder="Colour"
                      value={split.colour}
                      onChange={(event) =>
                        setColours((list) =>
                          list.map((entry, i) => (i === index ? { ...entry, colour: event.target.value } : entry)),
                        )
                      }
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Units"
                      value={split.quantity}
                      onChange={(event) =>
                        setColours((list) =>
                          list.map((entry, i) =>
                            i === index ? { ...entry, quantity: event.target.value.replace(/[^0-9]/g, "") } : entry,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="file-remove"
                      onClick={() => setColours((list) => list.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => setColours((list) => [...list, { colour: "", quantity: "" }])}
                >
                  Add a colour
                </button>
              </div>

              <TextArea
                label="Materials and quality"
                hint="Fabric, weight, trims, finish. Say what matters and what is negotiable."
                value={form.material_notes}
                onChange={setField("material_notes")}
              />

              <TermSelect
                label="Who buys the materials?"
                hint="This decides whether quotes are comparable at all — a full-package price and a CMT price are not the same number."
                terms={terms.sourcing_responsibility ?? []}
                value={
                  (terms.sourcing_responsibility ?? []).find((t) => t.id === form.sourcing)?.slug ?? ""
                }
                onChange={(slug) =>
                  setField("sourcing")(
                    (terms.sourcing_responsibility ?? []).find((t) => t.slug === slug)?.id ?? null,
                  )
                }
              />

              <ChipGroup
                label="Certifications you require"
                hint="Only what you genuinely require. Each one narrows who can bid."
                kind="certification"
                terms={terms.certification ?? []}
                selectedIds={selected.certification ?? []}
                onChange={setTermIds("certification")}
                orgId={org.id}
              />
            </>
          ) : null}

          {current.key === "timeline" ? (
            <>
              <div className="ob-field" data-field="delivery-month">
                <span className="ob-label">When do you need bulk delivered?</span>
                <span className="ob-hint ob-hint--above">
                  Used to check which factories still have capacity that month.
                </span>
                <select
                  value={form.target_delivery_month ?? ""}
                  onChange={(event) => setField("target_delivery_month")(event.target.value || null)}
                >
                  <option value="">Select…</option>
                  {months.map((month) => (
                    <option key={month.value} value={month.value}>{month.label}</option>
                  ))}
                </select>
              </div>

              <div className="ob-pair">
                <TextField label="Target unit price, from" value={form.price_min}
                  onChange={setField("price_min")} inputMode="decimal" placeholder="18" />
                <TextField label="to" value={form.price_max}
                  onChange={setField("price_max")} inputMode="decimal" placeholder="24" />
              </div>
              <p className="ob-hint">Per unit, in USD. A range is fine — it filters out quotes neither of you would accept.</p>

              <label className="agree-row">
                <input
                  type="checkbox"
                  checked={Boolean(form.requires_sample)}
                  onChange={(event) => setField("requires_sample")(event.target.checked)}
                />
                <span>I need samples approved before bulk production starts.</span>
              </label>

              {form.requires_sample ? (
                <TextArea
                  label="Sample plan"
                  hint="Which samples, and what has to be signed off before bulk."
                  value={form.sample_notes}
                  onChange={setField("sample_notes")}
                  rows={3}
                />
              ) : null}

              <TextField
                label="Quotes due by"
                hint="Factories cannot submit after this date."
                type="date"
                value={form.quote_deadline}
                onChange={setField("quote_deadline")}
              />

              <ChipGroup
                label="Preferred regions"
                hint="Leave blank if you are open to anywhere."
                kind="region"
                terms={terms.region ?? []}
                selectedIds={selected.region ?? []}
                onChange={setTermIds("region")}
                orgId={org.id}
              />
            </>
          ) : null}

          {current.key === "questions" ? (
            <>
              <div className="ob-field" data-field="factory-questions">
                <span className="ob-label">Questions every factory should answer</span>
                <span className="ob-hint ob-hint--above">
                  Answers arrive with each quote, so you compare like for like instead of chasing
                  five separate email threads.
                </span>

                {questions.map((question, index) => (
                  <div className="question-row" key={index}>
                    <input
                      type="text"
                      value={question.prompt}
                      placeholder="Can you quote fit and PP samples separately?"
                      onChange={(event) =>
                        setQuestionList((list) =>
                          list.map((entry, i) => (i === index ? { ...entry, prompt: event.target.value } : entry)),
                        )
                      }
                    />
                    <label className="question-private">
                      <input
                        type="checkbox"
                        checked={Boolean(question.is_sensitive)}
                        onChange={(event) =>
                          setQuestionList((list) =>
                            list.map((entry, i) =>
                              i === index ? { ...entry, is_sensitive: event.target.checked } : entry,
                            ),
                          )
                        }
                      />
                      <span>Private</span>
                    </label>
                    <button
                      type="button"
                      className="file-remove"
                      onClick={() => setQuestionList((list) => list.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="secondary-btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => setQuestionList((list) => [...list, { prompt: "", is_sensitive: false }])}
                >
                  Add a question
                </button>

                <p className="ob-hint" style={{ marginTop: 8 }}>
                  Answers are shared with the other factories quoting, so nobody has to ask the same
                  thing twice. Mark a question private and only you see its answer.
                </p>
              </div>

              <TextArea
                label="Anything else factories should know"
                value={form.additional_details}
                onChange={setField("additional_details")}
                rows={4}
              />
            </>
          ) : null}

          {current.key === "review" ? (
            <>
              <div className="review-grid">
                {gaps.map((gap) => (
                  <div key={gap.key} className={`review-row${gap.done ? " is-done" : ""}`}>
                    <span className="review-mark">{gap.done ? "✓" : "—"}</span>
                    <span className="review-label">{gap.label}</span>
                    <span className="review-state">{gap.done ? "Added" : "Not added"}</span>
                  </div>
                ))}
              </div>

              <div className="ob-field" data-field="who-can-see-this">
                <span className="ob-label">Who can see this request?</span>
                <div className="kind-grid">
                  <button
                    type="button"
                    className={`kind-card${visibility === "open_to_all" ? " is-selected" : ""}`}
                    aria-pressed={visibility === "open_to_all"}
                    onClick={() => setVisibility("open_to_all")}
                  >
                    <strong>Any factory on the Club</strong>
                    <span>
                      More quotes, and factories you would not have found. Only verified factories
                      can bid.
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`kind-card${visibility === "invited_only" ? " is-selected" : ""}`}
                    aria-pressed={visibility === "invited_only"}
                    onClick={() => setVisibility("invited_only")}
                  >
                    <strong>Only factories I invite</strong>
                    <span>You pick who sees it on the next screen.</span>
                  </button>
                </div>
              </div>

              <p className="ob-hint">
                Publishing does not commit you to anything. You choose whether to award at all.
              </p>
            </>
          ) : null}

          {error ? <p className="ob-error">{error.message}</p> : null}
        </div>

        <footer className="ob-actions">
          <button
            type="button"
            className="quiet-btn"
            onClick={() => (step === 0 ? navigate("/rfqs") : setStep((c) => c - 1))}
            disabled={saving}
          >
            {step === 0 ? "Save and close" : "Back"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={isLast ? publish : next}
            disabled={saving}
          >
            {saving ? "Saving…" : isLast ? "Publish request" : "Continue"}
          </button>
        </footer>
      </main>
    </div>
  );
}
