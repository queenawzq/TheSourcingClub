/**
 * Factory onboarding, backed by the database.
 *
 * Same shape as the brand flow — saves per step, resumes where it stopped,
 * every option list from taxonomy_terms — with two differences that matter:
 *
 *   * Capacity. The one implementation of the hours-to-pieces conversion,
 *     replacing four in the prototypes.
 *
 *   * Finishing publishes the profile, which is what makes a factory findable.
 *     Publishing and being verified are separate: an unverified factory can be
 *     found and read, but cannot quote until an admin has checked its
 *     registration. Gating visibility instead would show a new factory an empty
 *     marketplace on its first day.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listTermsByKind, setLinks } from "../../lib/domain/taxonomy.js";
import {
  completeOnboarding,
  getFactoryProfile,
  getSelectedTerms,
  saveFactoryProfile,
} from "../../lib/domain/profile.js";
import { deleteDocument, listDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { getCapacity, saveCapacity } from "../../lib/domain/capacity-store.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { ChipGroup, TermSelect, TextArea, TextField, UploadField } from "./fields.jsx";
import CapacityEditor from "./CapacityEditor.jsx";
import "./onboarding.css";

const TERMS_VERSION = "2026-09-01";

const KINDS = [
  "country",
  "production_type",
  "product_category",
  "make",
  "market_level",
  "specialty",
  "design_service",
  "digital_tool",
  "certification",
  "capacity_category",
];

const STEPS = [
  { key: "basics", title: "Factory basics", blurb: "How brands will find and recognise you." },
  { key: "company", title: "Company details", blurb: "The formal facts, used for verification." },
  { key: "makes", title: "What you make", blurb: "Drives which requests reach you." },
  { key: "skills", title: "Services and equipment", blurb: "What you can do beyond sewing." },
  { key: "capacity", title: "Capacity and terms", blurb: "So brands know whether to ask." },
  { key: "verification", title: "Verification", blurb: "What lets you quote on open requests." },
  { key: "showcase", title: "Show your floor", blurb: "The thing brands actually want to see." },
  { key: "review", title: "Review", blurb: "Check it over before you go live." },
  { key: "terms", title: "Terms", blurb: "The agreement between you and the Club." },
];

export default function FactoryOnboarding({ org, user, onComplete }) {
  const [terms, setTerms] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selected, setSelected] = useState({});
  const [documents, setDocuments] = useState([]);
  const [capacity, setCapacity] = useState({ input_mode: "units" });
  const [months, setMonths] = useState({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");

  const setField = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const setTermIds = (kind) => (ids) => setSelected((current) => ({ ...current, [kind]: ids }));

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      listTermsByKind(KINDS),
      getFactoryProfile(org.id),
      getSelectedTerms("factory_profile", org.id),
      listDocuments(org.id),
      getCapacity(org.id),
    ])
      .then(([termsByKind, factoryProfile, selectedTerms, docs, storedCapacity]) => {
        if (cancelled) return;

        setTerms(termsByKind);
        setProfile(factoryProfile);
        setSelected(selectedTerms);
        setDocuments(docs);
        setCapacity(storedCapacity.capacity ?? { input_mode: "units" });
        setMonths(storedCapacity.months ?? {});
        setForm({
          legal_name: factoryProfile?.legal_name ?? org.name,
          website_url: factoryProfile?.website_url ?? "",
          location: factoryProfile?.location ?? "",
          country: factoryProfile?.country_code ?? "",
          nearest_port: factoryProfile?.nearest_port ?? "",
          founded_year: factoryProfile?.founded_year ?? "",
          registration_date: factoryProfile?.registration_date ?? "",
          employee_count: factoryProfile?.employee_count ?? "",
          registered_capital: factoryProfile?.registered_capital ?? "",
          intro: factoryProfile?.intro ?? "",
          equipment_notes: factoryProfile?.equipment_notes ?? "",
          moq: factoryProfile?.moq ?? "",
          typical_lead_days: factoryProfile?.typical_lead_days ?? "",
        });
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

  /** The country picker stores an ISO code, which is what match_score compares. */
  function countryCodeFor(slug) {
    const term = (terms?.country ?? []).find((entry) => entry.slug === slug);
    return term?.extra?.code ?? null;
  }

  async function saveStep() {
    const key = STEPS[step].key;
    const patch = {};
    const linkKinds = [];

    if (key === "basics") {
      Object.assign(patch, {
        legal_name: form.legal_name || null,
        website_url: form.website_url || null,
        location: form.location || null,
        country_code: countryCodeFor(form.country),
        nearest_port: form.nearest_port || null,
        founded_year: form.founded_year ? Number(form.founded_year) : null,
        intro: form.intro || null,
      });
    }

    if (key === "company") {
      Object.assign(patch, {
        registration_date: form.registration_date || null,
        employee_count: form.employee_count ? Number(form.employee_count) : null,
        registered_capital: form.registered_capital || null,
      });
    }

    if (key === "makes") {
      linkKinds.push("production_type", "product_category", "make", "market_level");
    }

    if (key === "skills") {
      patch.equipment_notes = form.equipment_notes || null;
      linkKinds.push("specialty", "design_service", "digital_tool");
    }

    if (key === "capacity") {
      Object.assign(patch, {
        moq: form.moq ? Number(form.moq) : null,
        typical_lead_days: form.typical_lead_days ? Number(form.typical_lead_days) : null,
      });
      await saveCapacity(org.id, capacity, months);
    }

    if (key === "verification") {
      linkKinds.push("certification");
    }

    if (Object.keys(patch).length) {
      setProfile(await saveFactoryProfile(org.id, patch));
    }

    for (const kind of linkKinds) {
      await setLinks({
        subjectType: "factory_profile",
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
        await completeOnboarding(org.id, "factory");
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

  const checklist = useMemo(() => {
    const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;
    const hasDoc = (kind) => documents.some((doc) => doc.kind === kind);
    return [
      { label: "Factory basics", done: Boolean(profile?.legal_name && profile?.country_code) },
      { label: "What you make", done: has("production_type") && has("product_category") },
      { label: "Capacity", done: Boolean(capacity?.line_hours || capacity?.monthly_units) },
      { label: "Business registration", done: hasDoc("business_registration") },
      { label: "Photos of your floor", done: hasDoc("walkthrough") || hasDoc("product_image") },
    ];
  }, [profile, selected, documents, capacity]);

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
  const canContinue = current.key !== "terms" || (agreed && signature.trim().length > 1);

  return (
    <div className="ob-shell">
      <aside className="ob-rail">
        <p className="ob-rail-head">Set up {org.name}</p>
        <ol className="ob-steps">
          {STEPS.map((entry, index) => (
            <li
              key={entry.key}
              className={index === step ? "is-current" : index < step ? "is-done" : undefined}
            >
              <span className="ob-step-num">{index < step ? "✓" : index + 1}</span>
              <button type="button" onClick={() => index < step && setStep(index)} disabled={index > step}>
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
              <TextField label="Factory name" value={form.legal_name} onChange={setField("legal_name")} />
              <TermSelect
                label="Country"
                terms={terms.country ?? []}
                value={form.country}
                onChange={setField("country")}
              />
              <TextField
                label="City or region"
                value={form.location}
                onChange={setField("location")}
                placeholder="Ningbo, Zhejiang"
              />
              <TextField
                label="Nearest port"
                hint="Helps brands estimate shipping before they ask."
                value={form.nearest_port}
                onChange={setField("nearest_port")}
              />
              <TextField
                label="Year founded"
                value={form.founded_year}
                onChange={setField("founded_year")}
                inputMode="numeric"
              />
              <TextField label="Website" value={form.website_url} onChange={setField("website_url")} placeholder="https://" />
              <TextArea
                label="About your factory"
                hint="What you are good at, in your own words. Brands read this first."
                value={form.intro}
                onChange={setField("intro")}
              />
            </>
          ) : null}

          {current.key === "company" ? (
            <>
              <TextField
                label="Company registration date"
                hint="As shown on your business licence."
                value={form.registration_date}
                onChange={setField("registration_date")}
                type="date"
              />
              <TextField
                label="Total employees"
                value={form.employee_count}
                onChange={setField("employee_count")}
                inputMode="numeric"
              />
              <TextField
                label="Registered capital"
                hint="Optional."
                value={form.registered_capital}
                onChange={setField("registered_capital")}
              />
            </>
          ) : null}

          {current.key === "makes" ? (
            <>
              <ChipGroup label="Production type" kind="production_type" terms={terms.production_type ?? []}
                selectedIds={selected.production_type ?? []} onChange={setTermIds("production_type")} orgId={org.id} />
              <ChipGroup label="Product categories" kind="product_category" terms={terms.product_category ?? []}
                selectedIds={selected.product_category ?? []} onChange={setTermIds("product_category")} orgId={org.id} />
              <ChipGroup label="Specific items you make" hint="More specific than categories. Helps you show up for the right requests."
                kind="make" terms={terms.make ?? []} selectedIds={selected.make ?? []} onChange={setTermIds("make")} orgId={org.id} />
              <ChipGroup label="Market level" kind="market_level" terms={terms.market_level ?? []}
                selectedIds={selected.market_level ?? []} onChange={setTermIds("market_level")} orgId={org.id} />
            </>
          ) : null}

          {current.key === "skills" ? (
            <>
              <ChipGroup label="What you specialise in" kind="specialty" terms={terms.specialty ?? []}
                selectedIds={selected.specialty ?? []} onChange={setTermIds("specialty")} orgId={org.id} />
              <ChipGroup label="Design and development services" kind="design_service" terms={terms.design_service ?? []}
                selectedIds={selected.design_service ?? []} onChange={setTermIds("design_service")} orgId={org.id} />
              <ChipGroup label="Digital tools" kind="digital_tool" terms={terms.digital_tool ?? []}
                selectedIds={selected.digital_tool ?? []} onChange={setTermIds("digital_tool")} orgId={org.id} />
              <TextArea
                label="Key machines or equipment"
                hint="Free text — be as specific as you like. Brands with technical requirements read this closely."
                value={form.equipment_notes}
                onChange={setField("equipment_notes")}
                rows={4}
              />
            </>
          ) : null}

          {current.key === "capacity" ? (
            <>
              <CapacityEditor
                categories={terms.capacity_category ?? []}
                capacity={capacity}
                months={months}
                onChange={setCapacity}
                onMonthChange={(key, level) => setMonths((current) => ({ ...current, [key]: level }))}
              />
              <div className="ob-pair">
                <TextField label="Minimum order quantity" hint="Per style. Approximate is fine."
                  value={form.moq} onChange={setField("moq")} inputMode="numeric" placeholder="150" />
                <TextField label="Typical lead time, days" hint="After sample approval."
                  value={form.typical_lead_days} onChange={setField("typical_lead_days")} inputMode="numeric" placeholder="28" />
              </div>
            </>
          ) : null}

          {current.key === "verification" ? (
            <>
              <UploadField
                label="Business registration"
                hint="Reviewed by us, never shown to brands. Until it is verified you can browse requests but not quote on them."
                accept="application/pdf,image/png,image/jpeg"
                isPrivate
                existing={docsOfKind("business_registration")}
                onUpload={(file) => handleUpload("business_registration", file)}
                onRemove={handleRemove}
              />
              <ChipGroup
                label="Certifications you hold"
                hint="Select them here, then upload the certificate. Only verified certifications count towards matching."
                kind="certification"
                terms={terms.certification ?? []}
                selectedIds={selected.certification ?? []}
                onChange={setTermIds("certification")}
                orgId={org.id}
              />
              <UploadField
                label="Certificates"
                accept="application/pdf,image/png,image/jpeg"
                isPrivate
                existing={docsOfKind("certificate")}
                onUpload={(file) => handleUpload("certificate", file)}
                onRemove={handleRemove}
              />
            </>
          ) : null}

          {current.key === "showcase" ? (
            <>
              <UploadField
                label="Your factory floor"
                hint="A short video walkthrough, or photos. This is the single thing brands most want to see before they trust a new factory."
                accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
                existing={docsOfKind("walkthrough")}
                onUpload={(file) => handleUpload("walkthrough", file)}
                onRemove={handleRemove}
              />
              <UploadField
                label="Sample work"
                hint="Pieces you have made. No brand names needed if you are under NDA."
                accept="image/png,image/jpeg,image/webp"
                existing={docsOfKind("product_image")}
                onUpload={(file) => handleUpload("product_image", file)}
                onRemove={handleRemove}
              />
            </>
          ) : null}

          {current.key === "review" ? (
            <div className="review-grid">
              {checklist.map((entry) => (
                <div key={entry.label} className={`review-row${entry.done ? " is-done" : ""}`}>
                  <span className="review-mark">{entry.done ? "✓" : "—"}</span>
                  <span className="review-label">{entry.label}</span>
                  <span className="review-state">{entry.done ? "Added" : "Not added yet"}</span>
                </div>
              ))}
              <p className="ob-hint">
                Finishing publishes your profile so brands can find you. You can still quote only
                once your registration has been verified — usually within a working day.
              </p>
            </div>
          ) : null}

          {current.key === "terms" ? (
            <>
              <div className="terms-box">
                <h3>Working through the Club</h3>
                <p>
                  Quotes, orders and payments stay on the platform. Taking a brand off-platform to
                  avoid fees is the one thing that will get an account closed.
                </p>
                <h3>What we check</h3>
                <p>
                  We verify your business registration and any certificates you upload. We do not
                  inspect factories in person, and being verified is not a claim about your quality.
                </p>
                <h3>Your information</h3>
                <p>
                  Your registration and certificates are private to you and our review team. Brands
                  see your profile, your capacity, and whether you are verified.
                </p>
              </div>

              <label className="agree-row">
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                <span>I have read and agree to the terms and platform rules.</span>
              </label>

              <TextField label="Type your full name to sign" value={signature} onChange={setSignature} autoComplete="name" />
            </>
          ) : null}

          {error ? <p className="ob-error">{error.message}</p> : null}
        </div>

        <footer className="ob-actions">
          <button type="button" className="quiet-btn" onClick={() => setStep((c) => Math.max(0, c - 1))} disabled={step === 0 || saving}>
            Back
          </button>
          <button type="button" className="primary-btn" onClick={next} disabled={saving || !canContinue}>
            {saving ? "Saving…" : current.key === "terms" ? "Publish my profile" : "Continue"}
          </button>
        </footer>
      </main>
    </div>
  );
}
