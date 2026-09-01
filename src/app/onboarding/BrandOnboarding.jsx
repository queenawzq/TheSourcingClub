/**
 * Brand onboarding, backed by the database.
 *
 * Every step saves as it is completed rather than everything landing at the
 * end, so closing the tab halfway through loses nothing and the flow resumes
 * where it stopped. The prototype's version used uncontrolled inputs whose
 * values were discarded entirely.
 *
 * Vocabularies come from taxonomy_terms; nothing here hardcodes an option list.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listTermsByKind, setLinks } from "../../lib/domain/taxonomy.js";
import {
  brandProfileGaps,
  completeOnboarding,
  getBrandProfile,
  getSelectedTerms,
  saveBrandProfile,
} from "../../lib/domain/profile.js";
import { deleteDocument, listDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { inviteMember } from "../../lib/domain/org.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { ChipGroup, TermSelect, TextArea, TextField, UploadField } from "./fields.jsx";
import "./onboarding.css";

/** Bump when the wording changes materially; recorded against each signature. */
const TERMS_VERSION = "2026-09-01";

const KINDS = [
  "brand_category",
  "production_type",
  "product_category",
  "market_level",
  "region",
  "certification",
  "service",
  "pieces_per_year_band",
  "order_size_band",
  "collections_per_year",
  "reorder_cadence",
  "sourcing_stage",
  "annual_revenue_band",
];

const STEPS = [
  { key: "basics", title: "Brand basics", blurb: "How factories will recognise you." },
  { key: "about", title: "About your brand", blurb: "What you make and who it is for." },
  { key: "makes", title: "What you make", blurb: "Used to match you with the right factories." },
  { key: "sourcing", title: "Sourcing plan", blurb: "Volume and cadence, so quotes are realistic." },
  { key: "preferences", title: "Factory preferences", blurb: "Where and how you want to produce." },
  { key: "trust", title: "Trust and verification", blurb: "What makes factories confident quoting you." },
  { key: "review", title: "Review", blurb: "Check it over before we publish." },
  { key: "terms", title: "Terms", blurb: "The agreement between you and the Club." },
];

/** Dollars in the interface, minor units in the database. */
const toCents = (value) => {
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};
const fromCents = (cents) => (cents == null ? "" : String(cents / 100));

export default function BrandOnboarding({ org, user, onComplete }) {
  const [terms, setTerms] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selected, setSelected] = useState({});
  const [documents, setDocuments] = useState([]);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({});
  const [stakeholders, setStakeholders] = useState([]);
  const [stakeholderDraft, setStakeholderDraft] = useState({ email: "", role: "" });
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");

  const setField = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const setTermIds = (kind) => (ids) => setSelected((current) => ({ ...current, [kind]: ids }));

  // Load everything the flow needs in one pass.
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      listTermsByKind(KINDS),
      getBrandProfile(org.id),
      getSelectedTerms("brand_profile", org.id),
      listDocuments(org.id),
    ])
      .then(([termsByKind, brandProfile, selectedTerms, docs]) => {
        if (cancelled) return;

        setTerms(termsByKind);
        setProfile(brandProfile);
        setSelected(selectedTerms);
        setDocuments(docs);
        setForm({
          legal_name: brandProfile?.legal_name ?? org.name,
          business_email: brandProfile?.business_email ?? user?.email ?? "",
          website_url: brandProfile?.website_url ?? "",
          hq_location: brandProfile?.hq_location ?? "",
          founded_year: brandProfile?.founded_year ?? "",
          intro: brandProfile?.intro ?? "",
          brand_category: brandProfile?.brand_category ?? "",
          pieces_per_year_band: brandProfile?.pieces_per_year_band ?? "",
          order_size_band: brandProfile?.order_size_band ?? "",
          collections_per_year: brandProfile?.collections_per_year ?? "",
          reorder_cadence: brandProfile?.reorder_cadence ?? "",
          sourcing_stage: brandProfile?.sourcing_stage ?? "",
          annual_revenue_band: brandProfile?.annual_revenue_band ?? "",
          target_price_min: fromCents(brandProfile?.target_price_min_cents),
          target_price_max: fromCents(brandProfile?.target_price_max_cents),
        });

        // Resume at the first step that still has a gap.
        const gaps = brandProfileGaps(brandProfile, selectedTerms, docs);
        const firstGap = gaps.findIndex((gap) => !gap.done);
        if (brandProfile && firstGap > 0) {
          setStep(Math.min(firstGap, STEPS.length - 1));
        }
      })
      .catch((failure) => {
        if (!cancelled) setLoadError(failure);
      });

    return () => {
      cancelled = true;
    };
  }, [org.id]);

  const refreshDocuments = useCallback(async () => {
    setDocuments(await listDocuments(org.id));
  }, [org.id]);

  const docsOfKind = useCallback(
    (kind) => documents.filter((doc) => doc.kind === kind),
    [documents],
  );

  async function handleUpload(kind, file) {
    await uploadDocument({ orgId: org.id, kind, file });
    await refreshDocuments();
  }

  async function handleRemove(doc) {
    await deleteDocument(doc);
    await refreshDocuments();
  }

  /** Persist just the current step, then advance. */
  async function saveStep() {
    const key = STEPS[step].key;
    const patch = {};
    const linkKinds = [];

    if (key === "basics") {
      Object.assign(patch, {
        legal_name: form.legal_name || null,
        business_email: form.business_email || null,
        website_url: form.website_url || null,
        hq_location: form.hq_location || null,
        founded_year: form.founded_year ? Number(form.founded_year) : null,
        brand_category: form.brand_category || null,
      });
    }

    if (key === "about") {
      patch.intro = form.intro || null;
    }

    if (key === "makes") {
      linkKinds.push("production_type", "product_category", "market_level");
    }

    if (key === "sourcing") {
      Object.assign(patch, {
        pieces_per_year_band: form.pieces_per_year_band || null,
        order_size_band: form.order_size_band || null,
        collections_per_year: form.collections_per_year || null,
        reorder_cadence: form.reorder_cadence || null,
        sourcing_stage: form.sourcing_stage || null,
        target_price_min_cents: form.target_price_min ? toCents(form.target_price_min) : null,
        target_price_max_cents: form.target_price_max ? toCents(form.target_price_max) : null,
      });
    }

    if (key === "preferences") {
      linkKinds.push("region", "certification", "service");
    }

    if (key === "trust") {
      patch.annual_revenue_band = form.annual_revenue_band || null;
    }

    if (Object.keys(patch).length) {
      setProfile(await saveBrandProfile(org.id, patch));
    }

    for (const kind of linkKinds) {
      await setLinks({
        subjectType: "brand_profile",
        subjectId: org.id,
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

      if (STEPS[step].key === "terms") {
        unwrap(
          await supabase.from("terms_acceptances").insert({
            org_id: org.id,
            terms_version: TERMS_VERSION,
            signature: signature.trim(),
            accepted_by: user.id,
          }),
          "record your agreement",
        );

        for (const person of stakeholders) {
          await inviteMember(org.id, person.email);
        }

        await completeOnboarding(org.id, "brand");
        onComplete();
        return;
      }

      setStep((current) => Math.min(current + 1, STEPS.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  }

  const gaps = useMemo(
    () => brandProfileGaps(profile, selected, documents),
    [profile, selected, documents],
  );

  if (loadError) {
    return (
      <div className="ob-shell">
        <div className="ob-panel">
          <h1>Could not load your profile</h1>
          <p className="ob-error">{loadError.message}</p>
        </div>
      </div>
    );
  }

  if (!terms) {
    return (
      <div className="ob-shell">
        <div className="ob-panel">
          <div className="spinner" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const current = STEPS[step];
  const canContinue =
    current.key !== "terms" || (agreed && signature.trim().length > 1);

  return (
    <div className="ob-shell">
      <aside className="ob-rail">
        <p className="ob-rail-head">Set up {org.name}</p>
        <ol className="ob-steps">
          {STEPS.map((entry, index) => (
            <li
              key={entry.key}
              className={
                index === step ? "is-current" : index < step ? "is-done" : undefined
              }
            >
              <span className="ob-step-num">{index < step ? "✓" : index + 1}</span>
              <button
                type="button"
                onClick={() => index < step && setStep(index)}
                disabled={index > step}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="ob-main">
        <header className="ob-head">
          <p className="ob-eyebrow">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1>{current.title}</h1>
          <p className="ob-blurb">{current.blurb}</p>
        </header>

        <div className="ob-body">
          {current.key === "basics" ? (
            <>
              <TextField
                label="Brand name"
                value={form.legal_name}
                onChange={setField("legal_name")}
                autoComplete="organization"
              />
              <TermSelect
                label="Brand category"
                terms={terms.brand_category ?? []}
                value={form.brand_category}
                onChange={setField("brand_category")}
              />
              <TextField
                label="Business email"
                hint="Where factories reach you. It does not have to be your sign-in address."
                value={form.business_email}
                onChange={setField("business_email")}
                type="email"
              />
              <TextField
                label="Head office location"
                hint="City and country."
                value={form.hq_location}
                onChange={setField("hq_location")}
              />
              <TextField
                label="Year founded"
                value={form.founded_year}
                onChange={setField("founded_year")}
                inputMode="numeric"
              />
              <TextField
                label="Website"
                value={form.website_url}
                onChange={setField("website_url")}
                placeholder="https://"
              />
            </>
          ) : null}

          {current.key === "about" ? (
            <>
              <TextArea
                label="About your brand"
                hint="A few sentences. Factories read this first when deciding whether to quote."
                value={form.intro}
                onChange={setField("intro")}
                rows={6}
              />
              <UploadField
                label="Logo"
                hint="PNG, JPG or SVG. Shown on your profile and on every request you send."
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                existing={docsOfKind("logo")}
                onUpload={(file) => handleUpload("logo", file)}
                onRemove={handleRemove}
              />
              <UploadField
                label="Product or production images"
                hint="Past work, references, or the direction you are heading."
                accept="image/png,image/jpeg,image/webp"
                existing={docsOfKind("product_image")}
                onUpload={(file) => handleUpload("product_image", file)}
                onRemove={handleRemove}
              />
            </>
          ) : null}

          {current.key === "makes" ? (
            <>
              <ChipGroup
                label="Production type"
                kind="production_type"
                terms={terms.production_type ?? []}
                selectedIds={selected.production_type ?? []}
                onChange={setTermIds("production_type")}
                orgId={org.id}
              />
              <ChipGroup
                label="Product categories"
                kind="product_category"
                terms={terms.product_category ?? []}
                selectedIds={selected.product_category ?? []}
                onChange={setTermIds("product_category")}
                orgId={org.id}
              />
              <ChipGroup
                label="Market level"
                hint="Pick the one that best describes your retail price point."
                kind="market_level"
                terms={terms.market_level ?? []}
                selectedIds={selected.market_level ?? []}
                onChange={setTermIds("market_level")}
                orgId={org.id}
              />
            </>
          ) : null}

          {current.key === "sourcing" ? (
            <>
              <TermSelect
                label="Pieces ordered per year"
                terms={terms.pieces_per_year_band ?? []}
                value={form.pieces_per_year_band}
                onChange={setField("pieces_per_year_band")}
              />
              <TermSelect
                label="Typical order size per style"
                terms={terms.order_size_band ?? []}
                value={form.order_size_band}
                onChange={setField("order_size_band")}
              />
              <TermSelect
                label="Collections per year"
                terms={terms.collections_per_year ?? []}
                value={form.collections_per_year}
                onChange={setField("collections_per_year")}
              />
              <div className="ob-pair">
                <TextField
                  label="Target unit price, from"
                  value={form.target_price_min}
                  onChange={setField("target_price_min")}
                  inputMode="decimal"
                  placeholder="18"
                />
                <TextField
                  label="to"
                  value={form.target_price_max}
                  onChange={setField("target_price_max")}
                  inputMode="decimal"
                  placeholder="24"
                />
              </div>
              <p className="ob-hint">Per unit, in USD. Other currencies are coming.</p>
              <TermSelect
                label="Reorder cadence"
                terms={terms.reorder_cadence ?? []}
                value={form.reorder_cadence}
                onChange={setField("reorder_cadence")}
              />
              <TermSelect
                label="Where you are right now"
                terms={terms.sourcing_stage ?? []}
                value={form.sourcing_stage}
                onChange={setField("sourcing_stage")}
              />
            </>
          ) : null}

          {current.key === "preferences" ? (
            <>
              <ChipGroup
                label="Preferred regions"
                hint="Leave blank if you are open to anywhere."
                kind="region"
                terms={terms.region ?? []}
                selectedIds={selected.region ?? []}
                onChange={setTermIds("region")}
                orgId={org.id}
              />
              <ChipGroup
                label="Certifications you require"
                hint="Only pick what you genuinely require. Each one narrows your matches."
                kind="certification"
                terms={terms.certification ?? []}
                selectedIds={selected.certification ?? []}
                onChange={setTermIds("certification")}
                orgId={org.id}
              />
              <ChipGroup
                label="Services you need"
                kind="service"
                terms={terms.service ?? []}
                selectedIds={selected.service ?? []}
                onChange={setTermIds("service")}
                orgId={org.id}
              />
            </>
          ) : null}

          {current.key === "trust" ? (
            <>
              <TermSelect
                label="Annual revenue"
                hint="Shown to factories as a band, never as a figure."
                terms={terms.annual_revenue_band ?? []}
                value={form.annual_revenue_band}
                onChange={setField("annual_revenue_band")}
              />

              <div className="ob-field">
                <span className="ob-label">Who else should have access?</span>
                <span className="ob-hint ob-hint--above">
                  They will be emailed an invitation when you finish. You can add more later.
                </span>

                {stakeholders.length ? (
                  <ul className="file-list">
                    {stakeholders.map((person) => (
                      <li key={person.email}>
                        <span className="file-name">{person.email}</span>
                        <span className="file-meta">{person.role || "Team member"}</span>
                        <button
                          type="button"
                          className="file-remove"
                          onClick={() =>
                            setStakeholders((list) =>
                              list.filter((entry) => entry.email !== person.email),
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="ob-pair">
                  <input
                    type="email"
                    placeholder="colleague@yourbrand.com"
                    value={stakeholderDraft.email}
                    onChange={(event) =>
                      setStakeholderDraft((draft) => ({ ...draft, email: event.target.value }))
                    }
                  />
                  <input
                    type="text"
                    placeholder="Their role, optional"
                    value={stakeholderDraft.role}
                    onChange={(event) =>
                      setStakeholderDraft((draft) => ({ ...draft, role: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={!stakeholderDraft.email.includes("@")}
                    onClick={() => {
                      const email = stakeholderDraft.email.trim().toLowerCase();
                      if (stakeholders.some((entry) => entry.email === email)) return;
                      setStakeholders((list) => [...list, { ...stakeholderDraft, email }]);
                      setStakeholderDraft({ email: "", role: "" });
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              <UploadField
                label="Business registration"
                hint="Reviewed by us, never shown to factories. This is what verifies your brand."
                accept="application/pdf,image/png,image/jpeg"
                isPrivate
                existing={docsOfKind("business_registration")}
                onUpload={(file) => handleUpload("business_registration", file)}
                onRemove={handleRemove}
              />
            </>
          ) : null}

          {current.key === "review" ? (
            <div className="review-grid">
              {gaps.map((gap) => (
                <div key={gap.key} className={`review-row${gap.done ? " is-done" : ""}`}>
                  <span className="review-mark">{gap.done ? "✓" : "—"}</span>
                  <span className="review-label">{gap.label}</span>
                  <span className="review-state">{gap.done ? "Added" : "Not added yet"}</span>
                </div>
              ))}
              <p className="ob-hint">
                Anything missing can be added later from your profile. Only your brand name and
                location are needed to start.
              </p>
            </div>
          ) : null}

          {current.key === "terms" ? (
            <>
              <div className="terms-box">
                <h3>Working through the Club</h3>
                <p>
                  Requests, quotes, and payments stay on the platform. Taking an introduction
                  off-platform to avoid fees is the one thing that will get an account closed.
                </p>
                <h3>What we verify</h3>
                <p>
                  We check business registrations and certificates. We do not inspect factories in
                  person, and a verified badge is not a guarantee of quality.
                </p>
                <h3>Your information</h3>
                <p>
                  Your registration documents are private to you and our review team. Factories see
                  only your profile, your requests, and whether you are verified.
                </p>
              </div>

              <label className="agree-row">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                <span>I have read and agree to the terms and platform rules.</span>
              </label>

              <TextField
                label="Type your full name to sign"
                value={signature}
                onChange={setSignature}
                autoComplete="name"
              />
            </>
          ) : null}

          {error ? <p className="ob-error">{error.message}</p> : null}
        </div>

        <footer className="ob-actions">
          <button
            type="button"
            className="quiet-btn"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || saving}
          >
            Back
          </button>
          <button type="button" className="primary-btn" onClick={next} disabled={saving || !canContinue}>
            {saving ? "Saving…" : current.key === "terms" ? "Finish" : "Continue"}
          </button>
        </footer>
      </main>
    </div>
  );
}
