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
import { uploadDocument } from "../../lib/domain/documents.js";

const TERMS_VERSION = "2026-09-01";

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

/** Designed English chip-group label → taxonomy kind. */
const KIND_FOR_LABEL = {
  "Production type": "production_type",
  "Product categories": "product_category",
  Makes: "make",
  "Market level": "market_level",
  "Specializes in": "specialty",
  "Design Services": "design_service",
  "Primary export markets": "region",
  "3D & digital tools (optional)": "digital_tool",
};

/** The first number in a free-text answer — "30-45 days" is 30. */
const firstNumber = (text) => {
  const match = String(text ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
};

export default function LiveFactoryOnboarding({ org, user, onComplete }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({});
  const [terms, setTerms] = useState({});
  const [companyType, setCompanyType] = useState("factory");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const kinds = useMemo(
    () => [...new Set([...Object.values(KIND_FOR_LABEL), "capacity_category", "country"])],
    [],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [byKind, selected, existing] = await Promise.all([
          listTermsByKind(kinds),
          getSelectedTerms("factory_profile", org.id),
          supabase.from("factory_profiles").select("*").eq("org_id", org.id).maybeSingle(),
        ]);
        if (cancelled) return;

        setTerms(byKind);

        const profile = existing.data ?? {};
        if (profile.vendor_kind === "trading_company") setCompanyType("trading");

        const restored = {};
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

  async function persist(submitted) {
    const patch = { vendor_kind: companyType === "trading" ? "trading_company" : "manufacturer" };
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
    const registration = submitted["business-registration"];
    if (registration instanceof File) {
      await uploadDocument({ orgId: org.id, kind: "business_registration", file: registration });
    }

    const location = submitted[factoryFieldName("Factory Location")];
    if (location !== undefined) {
      const code = countryCodeFrom(location);
      if (code) patch.country_code = code;
    }

    await saveFactoryProfile(org.id, patch);

    for (const { kind, termIds } of links) {
      await setLinks({ subjectType: "factory_profile", subjectId: org.id, orgId: org.id, kind, termIds });
    }

    // Capacity lives in its own table, keyed on a taxonomy term. The designed
    // panel publishes its category as the taxonomy slug already, so this is a
    // lookup rather than a mapping.
    const categorySlug = submitted["capacity-category"];
    const inputMode = submitted["capacity-input-mode"];
    if (categorySlug && inputMode) {
      const term = (terms.capacity_category ?? []).find((t) => t.slug === categorySlug);
      const hours = Number(submitted["capacity-line-hours"]) || null;
      const units = Number(submitted["capacity-units"]) || null;
      if (term && (hours || units)) {
        await supabase.from("factory_capacity").upsert(
          {
            org_id: org.id,
            category_term_id: term.id,
            input_mode: inputMode === "hours" ? "hours" : "units",
            line_hours: inputMode === "hours" ? hours : null,
            monthly_units: inputMode === "units" ? units : null,
          },
          { onConflict: "org_id" },
        );
      }
    }
  }

  async function next(submitted = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await persist(submitted);
      setValues((current) => ({ ...current, ...submitted }));

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

  return (
    <FactoryOnboarding
      companyType={companyType}
      language={language}
      step={step}
      onLanguageChange={setLanguage}
      onCompanyTypeChange={setCompanyType}
      onBack={() => setStep((current) => Math.max(0, current - 1))}
      onNext={next}
      onEditSection={(target) => typeof target === "number" && setStep(target)}
      optionsByLabel={optionsByLabel}
      values={values}
      busy={busy}
      error={error}
    />
  );
}
