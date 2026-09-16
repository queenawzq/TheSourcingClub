/**
 * Factory and trading-company onboarding, on Queena's designed screen.
 *
 * `FactoryOnboarding` is imported straight from src/factory-prototype/main.jsx
 * and mounted here with live data behind it — the eleven designed steps, the
 * EN/中文 toggle, the manufacturer-or-trading-company choice on the welcome
 * card, and the separate copy each of those gets. There is no second copy of
 * this UI.
 *
 * The same three things the brand seam keeps, for the same reasons: option
 * lists come from `taxonomy_terms` and never from the hardcoded arrays, every
 * step saves as it is left, and saves are partial upserts.
 *
 * Keys are derived from the ENGLISH copy whatever language is on screen, so a
 * factory that fills the form in Chinese writes to the same columns as one
 * that fills it in English.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FactoryOnboarding, factoryFieldName } from "../../factory-prototype/main.jsx";
import { listTermsByKind, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { completeOnboarding, getSelectedTerms, saveFactoryProfile } from "../../lib/domain/profile.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { deleteDocument, listDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { getCapacity, saveCapacity } from "../../lib/domain/capacity-store.js";
import { capacityWindow, monthKey } from "../../lib/domain/capacity.js";

const TERMS_VERSION = "2026-09-15";

/** Index of the designed "You're all set" card, the last of the eleven. */
const LAST_STEP = 10;

/** Designed English label → factory_profiles column. */
const COLUMN_FOR_LABEL = {
  "Factory Name": "legal_name",
  "Year Founded": "founded_year",
  "Website URL": "website_url",
  "Factory Location": "location",
  "Nearest Port": "nearest_port",
  "Total Employees": "employee_count",
  "About the factory": "intro",
  "Minimum Order Quantity": "moq",
  "Bulk Production Lead Time": "typical_lead_days",
  Equipment: "equipment_notes",
};

const NUMERIC_COLUMNS = new Set(["founded_year", "employee_count", "moq", "typical_lead_days"]);

/**
 * Designed English chip-group label → taxonomy kind.
 *
 * Every group the design draws is here. A group missing from this map shows
 * the design's hardcoded list and saves nothing, which is how "Manufacturing
 * model" — a required group — came to block anyone who left and came back.
 *
 * The trading-company copy asks its own versions of several questions, and
 * they are separate kinds rather than reused ones: a network's sourcing
 * countries and the markets it sells into are different answers, and sharing
 * one kind would make each save wipe the other.
 */
const KIND_FOR_LABEL = {
  "Manufacturing model": "manufacturing_model",
  "Production type": "production_type",
  "Product categories": "product_category",
  Makes: "make",
  "Market level": "market_level",
  "Specializes in": "specialty",
  "Design Services": "design_service",
  "Primary export markets": "region",
  "3D & digital tools (optional)": "digital_tool",
  // Trading company copy.
  "Production programs supported": "production_program",
  "Sourcing regions": "sourcing_region",
  "Core services": "core_service",
  "Product development": "product_development",
  "Quality & compliance": "quality_compliance",
  "Primary destination markets": "region",
  "Digital tools (optional)": "digital_tool",
};

/** The first number in a free-text answer — "30-45 days" is 30. */
const firstNumber = (text) => {
  const match = String(text ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
};

/**
 * The booking calendar is marked up against short month names on screen and
 * stored against the first of each month. This is the one translation.
 */
const shortMonth = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });

export default function LiveFactoryOnboarding({ org, user, onComplete, onSignOut }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({});
  const [terms, setTerms] = useState({});
  // Nothing is chosen until the vendor chooses it. This answer decides which
  // copy, which questions and which profile kind they get.
  const [companyType, setCompanyType] = useState(null);
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [certifications, setCertifications] = useState([]);
  const [registrationFileName, setRegistrationFileName] = useState("");

  const kinds = useMemo(
    () => [...new Set([...Object.values(KIND_FOR_LABEL), "capacity_category", "country", "certification"])],
    [],
  );

  /** Certifications claimed, each with the file behind it if there is one. */
  const loadCertifications = useCallback(async (byKind) => {
    const rows = unwrap(
      await supabase
        .from("factory_certifications")
        .select("id, term_id, status, document:documents (id, bucket, storage_path, file_name)")
        .eq("org_id", org.id)
        .order("created_at"),
      "load your certifications",
    );
    const list = byKind.certification ?? [];
    return rows
      .map((row) => {
        const term = list.find((item) => item.id === row.term_id);
        return term ? { id: row.id, termId: row.term_id, name: termLabel(term), fileName: row.document?.file_name ?? "", document: row.document } : null;
      })
      .filter(Boolean);
  }, [org.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [byKind, selected, existing, capacity, references, registrations, logos, samples] = await Promise.all([
          listTermsByKind(kinds),
          getSelectedTerms("factory_profile", org.id),
          supabase.from("factory_profiles").select("*").eq("org_id", org.id).maybeSingle(),
          getCapacity(org.id),
          supabase.from("profile_references").select("title, counterparty, sort").eq("org_id", org.id).order("sort"),
          listDocuments(org.id, "business_registration"),
          listDocuments(org.id, "logo"),
          listDocuments(org.id, "product_image"),
        ]);
        const certs = await loadCertifications(byKind);
        if (cancelled) return;

        setTerms(byKind);
        setCertifications(certs);
        setRegistrationFileName(
          registrations?.length > 1 ? `${registrations.length} files uploaded` : registrations?.[0]?.file_name ?? "",
        );

        const profile = existing.data ?? {};
        if (profile.vendor_kind === "trading_company") setCompanyType("trading");
        else if (profile.vendor_kind) setCompanyType("factory");

        const restored = {};
        if (logos?.length) restored["uploaded-logo"] = String(logos.length);
        if (samples?.length) restored["uploaded-samples"] = String(samples.length);
        for (const [label, column] of Object.entries(COLUMN_FOR_LABEL)) {
          if (profile[column] != null) restored[factoryFieldName(label)] = String(profile[column]);
        }
        for (const [label, kind] of Object.entries(KIND_FOR_LABEL)) {
          const ids = selected?.[kind] ?? [];
          const labels = (byKind[kind] ?? [])
            .filter((term) => ids.includes(term.id))
            .map((term) => termLabel(term, language));
          if (labels.length) restored[factoryFieldName(label)] = labels;
        }

        const row = capacity?.capacity;
        if (row) {
          const category = (byKind.capacity_category ?? []).find((term) => term.id === row.category_term_id);
          if (category) restored["capacity-category"] = category.slug;
          restored["capacity-input-mode"] = row.input_mode;
          if (row.line_hours) restored["capacity-line-hours"] = String(row.line_hours);
          if (row.monthly_units) restored["capacity-units"] = String(row.monthly_units);
        }
        const months = {};
        for (const date of capacityWindow(6)) {
          const level = capacity?.months?.[monthKey(date)];
          if (level) months[shortMonth(date)] = level;
        }
        if (Object.keys(months).length) restored["capacity-months"] = JSON.stringify(months);

        const referenceRows = references.data ?? [];
        if (referenceRows.length) {
          restored["client-references"] = JSON.stringify(
            referenceRows.map((reference) => ({ company: reference.title ?? "", contact: reference.counterparty ?? "" })),
          );
        }

        setValues(restored);
      } catch (loadError) {
        if (!cancelled) setError(loadError);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, kinds]);

  /**
   * Options keyed by the design's own English labels, in the reader's
   * language. The key is English; the text is not.
   */
  const optionsByLabel = useMemo(() => {
    const map = {};
    for (const [label, kind] of Object.entries(KIND_FOR_LABEL)) {
      const list = terms[kind];
      if (list?.length) map[label] = list.map((term) => termLabel(term, language));
    }
    return map;
  }, [terms, language]);

  const certificationOptions = useMemo(
    () => (terms.certification ?? []).map((term) => termLabel(term, "en")),
    [terms],
  );

  const termsFor = useCallback(
    (kind, labels) =>
      (terms[kind] ?? [])
        .filter((term) => labels.includes(termLabel(term, language)) || labels.includes(termLabel(term, "en")))
        .map((term) => term.id),
    [terms, language],
  );

  /**
   * The design asks for "Factory Location" as free text — "Porto, Portugal" —
   * and never for a country code. But country_code is what match_score
   * compares, so a profile without one is invisible to half the marketplace.
   *
   * Rather than adding a field the design does not have, the country is read
   * out of what the factory already typed, against the country taxonomy. No
   * match leaves it null, which is honest: better absent than wrong, because a
   * wrong code silently mis-matches rather than failing.
   */
  const countryCodeFrom = useCallback(
    (location) => {
      if (!location) return undefined;
      const text = String(location).toLowerCase();
      const hit = (terms.country ?? []).find((term) => {
        const en = String(term.label_en ?? "").toLowerCase();
        const zh = String(term.label_zh ?? "");
        return (en && text.includes(en)) || (zh && String(location).includes(zh));
      });
      return hit?.extra?.code ?? null;
    },
    [terms],
  );

  const certificationTerm = (name) =>
    (terms.certification ?? []).find((term) => termLabel(term, "en") === name || termLabel(term, language) === name);

  async function addCertification(name) {
    const term = certificationTerm(name);
    if (!term) throw new Error(`${name} is not a certification we recognise.`);
    unwrap(
      await supabase
        .from("factory_certifications")
        .upsert({ org_id: org.id, term_id: term.id }, { onConflict: "org_id,term_id", ignoreDuplicates: true }),
      "add the certification",
    );
    setCertifications(await loadCertifications(terms));
  }

  /** Certificates are reviewed, so a new file goes back into the queue as pending. */
  async function uploadCertificate(name, file) {
    const term = certificationTerm(name);
    if (!term) throw new Error(`${name} is not a certification we recognise.`);
    const previous = certifications.find((cert) => cert.termId === term.id)?.document;
    const document = await uploadDocument({ orgId: org.id, kind: "certificate", file });
    unwrap(
      await supabase
        .from("factory_certifications")
        .upsert({ org_id: org.id, term_id: term.id, document_id: document.id, status: "pending" }, { onConflict: "org_id,term_id" }),
      "attach the certificate",
    );
    if (previous) await deleteDocument(previous).catch(() => {});
    setCertifications(await loadCertifications(terms));
    return document.file_name;
  }

  async function deleteCertificate(name) {
    const cert = certifications.find((item) => item.name === name);
    if (!cert) return;
    unwrap(
      await supabase.from("factory_certifications").delete().eq("id", cert.id),
      "remove the certification",
    );
    if (cert.document) await deleteDocument(cert.document);
    setCertifications(await loadCertifications(terms));
  }

  async function persist(submitted) {
    const patch = {};
    if (companyType) patch.vendor_kind = companyType === "trading" ? "trading_company" : "manufacturer";
    const links = [];

    for (const [label, column] of Object.entries(COLUMN_FOR_LABEL)) {
      const raw = submitted[factoryFieldName(label)];
      if (raw === undefined) continue;
      const trimmed = typeof raw === "string" ? raw.trim() : raw;
      if (trimmed === "") {
        patch[column] = null;
      } else if (NUMERIC_COLUMNS.has(column)) {
        // "30-45 days" and "e.g. 120" both arrive as free text in the design.
        patch[column] = firstNumber(trimmed);
      } else {
        patch[column] = trimmed;
      }
    }

    for (const [label, kind] of Object.entries(KIND_FOR_LABEL)) {
      const chosen = submitted[factoryFieldName(label)];
      if (chosen === undefined) continue;
      links.push({ kind, termIds: termsFor(kind, chosen) });
    }

    // The business registration is what an admin reviews, and reviewing it is
    // what unlocks quoting. It goes to the private bucket, reachable only by a
    // signed URL.
    // Several documents, not one: a registration is often a certificate plus
    // a licence plus a translation, and replacing the last upload would lose
    // whichever the reviewer still needed.
    const registration = submitted["business-registration"];
    const registrationFiles = Array.isArray(registration) ? registration : registration instanceof File ? [registration] : [];
    if (registrationFiles.length) {
      for (const file of registrationFiles) {
        await uploadDocument({ orgId: org.id, kind: "business_registration", file });
      }
      const stored = await listDocuments(org.id, "business_registration");
      setRegistrationFileName(stored.length > 1 ? `${stored.length} files uploaded` : stored[0]?.file_name ?? "");
    }

    // Logo and samples are what a brand looks at, so they are public by kind.
    const uploads = {};
    const logo = submitted["factory-logo"];
    if (logo instanceof File) {
      await uploadDocument({ orgId: org.id, kind: "logo", file: logo });
      uploads["uploaded-logo"] = "1";
    }
    const samples = submitted["factory-samples"];
    if (Array.isArray(samples) && samples.length) {
      for (const file of samples) await uploadDocument({ orgId: org.id, kind: "product_image", file });
      uploads["uploaded-samples"] = String((Number(values["uploaded-samples"]) || 0) + samples.length);
    }
    if (Object.keys(uploads).length) setValues((current) => ({ ...current, ...uploads }));

    const location = submitted[factoryFieldName("Factory Location")];
    if (location !== undefined) {
      const code = countryCodeFrom(location);
      if (code) patch.country_code = code;
    }

    await saveFactoryProfile(org.id, patch);

    for (const { kind, termIds } of links) {
      await setLinks({ subjectType: "factory_profile", subjectId: org.id, orgId: org.id, kind, termIds });
    }

    // Capacity lives in its own tables, keyed on a taxonomy term. The designed
    // panel publishes its category as the taxonomy slug already, so this is a
    // lookup rather than a mapping.
    const inputMode = submitted["capacity-input-mode"];
    if (inputMode) {
      const term = (terms.capacity_category ?? []).find((t) => t.slug === submitted["capacity-category"]);
      let chosenMonths = {};
      try { chosenMonths = JSON.parse(submitted["capacity-months"] ?? "{}"); } catch { chosenMonths = {}; }
      const byKey = {};
      for (const date of capacityWindow(6)) {
        const level = chosenMonths[shortMonth(date)];
        if (level) byKey[monthKey(date)] = level;
      }
      await saveCapacity(
        org.id,
        {
          category_term_id: term?.id ?? null,
          input_mode: inputMode === "hours" ? "hours" : "units",
          line_hours: submitted["capacity-line-hours"],
          monthly_units: submitted["capacity-units"],
        },
        byKey,
      );
    }

    // References are a short list edited as a whole, so they are replaced as a
    // whole — the card is the complete answer.
    const referencesJson = submitted["client-references"];
    if (referencesJson !== undefined) {
      let references = [];
      try { references = JSON.parse(referencesJson); } catch { references = []; }
      unwrap(await supabase.from("profile_references").delete().eq("org_id", org.id), "update your references");
      const rows = references
        .map((reference, index) => ({
          org_id: org.id,
          title: String(reference.company || reference.contact || "").trim(),
          counterparty: String(reference.contact ?? "").trim() || null,
          sort: index,
        }))
        .filter((row) => row.title);
      if (rows.length) unwrap(await supabase.from("profile_references").insert(rows), "save your references");
    }
  }

  async function next(submitted = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await persist(submitted);
      // Files are not answers to restore; the upload counts persist() set are.
      const { "factory-logo": _logo, "factory-samples": _samples, "business-registration": _registration, ...answers } = submitted;
      setValues((current) => ({ ...current, ...answers }));

      if (submitted.signature) {
        unwrap(
          await supabase.from("terms_acceptances").insert({
            org_id: org.id,
            terms_version: TERMS_VERSION,
            signature: String(submitted.signature).trim(),
            accepted_by: user.id,
          }),
          "record your agreement",
        );
      }

      if (step === LAST_STEP - 1) {
        // The designed finish card says brands can now find you, so finishing
        // publishes. Verification stays separate: publishing controls
        // visibility, an admin review controls quoting.
        await saveFactoryProfile(org.id, { published_at: new Date().toISOString() });
        await completeOnboarding(org.id, "factory");
      }
      if (step >= LAST_STEP) {
        onComplete();
        return;
      }

      setStep((current) => current + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (saveError) {
      setError(saveError);
    } finally {
      setBusy(false);
    }
  }

  /** Save what is on the card, then sign out. A failed save keeps them here. */
  async function saveAndExit(submitted = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const partial = { ...submitted };
      // A signature on its own is not an agreement; leaving is not signing.
      delete partial.signature;
      await persist(partial);
      await onSignOut?.();
    } catch (saveError) {
      setError(saveError);
      setBusy(false);
    }
  }

  return (
    <FactoryOnboarding
      companyType={companyType}
      language={language}
      step={step}
      onLanguageChange={setLanguage}
      onCompanyTypeChange={setCompanyType}
      onBack={() => setStep((current) => Math.max(0, current - 1))}
      onNext={next}
      onSaveAndExit={onSignOut ? saveAndExit : undefined}
      onEditSection={(target) => typeof target === "number" && setStep(target)}
      optionsByLabel={optionsByLabel}
      values={values}
      busy={busy}
      error={error}
      certificationOptions={certificationOptions}
      certifications={certifications}
      onAddCertification={addCertification}
      onUploadCertificate={uploadCertificate}
      onDeleteCertificate={deleteCertificate}
      registrationFileName={registrationFileName}
    />
  );
}
