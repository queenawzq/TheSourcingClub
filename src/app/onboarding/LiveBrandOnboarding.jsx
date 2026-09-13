/**
 * Brand onboarding, on Queena's designed screen.
 *
 * There is no second copy of this UI. `BrandOnboarding` is imported straight
 * from src/prototype/main.jsx and mounted here with live data behind it — the
 * ten designed steps, the welcome card, the progress rail and the "you're all
 * set" screen, exactly as drawn.
 *
 * This file is the seam, not a screen. Its whole job is three things the
 * design has no opinion about and must not lose:
 *
 *   1. Option lists come from `taxonomy_terms`, never from the hardcoded
 *      arrays in the design. Matching is on slugs, so a hardcoded label that
 *      drifts from the vocabulary silently stops matching anything.
 *   2. Every step saves as it is left. Closing the tab mid-flow loses nothing
 *      and reopening resumes where the gap is.
 *   3. Saves are partial upserts, so a later step cannot blank an earlier one.
 *
 * The mapping below is the only place the design's visible labels meet the
 * database's column names. That is deliberate: rename a field in the design
 * and exactly one line changes here.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandOnboarding, onboardingFieldName } from "../../prototype/main.jsx";
import { listTermsByKind, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { completeOnboarding, getSelectedTerms, saveBrandProfile } from "../../lib/domain/profile.js";
import { inviteMember } from "../../lib/domain/org.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { toCents } from "../../lib/money.js";

const TERMS_VERSION = "2026-09-01";

/** Index of the designed "You're all set" card, the last of the ten. */
const LAST_STEP = 9;

/** Designed label → brand_profiles column. */
const COLUMN_FOR_LABEL = {
  "Brand name": "legal_name",
  "Business email": "business_email",
  "Website URL": "website_url",
  "HQ location": "hq_location",
  "Year founded": "founded_year",
  "About the brand": "intro",
  "Average pieces ordered per year": "pieces_per_year_band",
  "Typical order size per style": "order_size_band",
  "Collections per year": "collections_per_year",
  "Typical reorder cadence": "reorder_cadence",
  "Current sourcing stage": "sourcing_stage",
  "Annual revenue": "annual_revenue_band",
};

const NUMERIC_COLUMNS = new Set(["founded_year"]);

/** Designed chip-group label → taxonomy kind. */
const KIND_FOR_LABEL = {
  "What does your brand make?": "product_category",
  "Market level": "market_level",
  "Preferred regions": "region",
  Certifications: "certification",
  "Services needed": "service",
};

/** The one single-choice group stored as a slug column rather than a link. */
const CATEGORY_LABEL = "Brand category";
const CATEGORY_KIND = "brand_category";

/**
 * "$18 - $40" typed into one box, stored as two integer columns.
 *
 * The design asks for a range in a single field. Parsing it here rather than
 * splitting the field keeps the screen as drawn, and a value that cannot be
 * read is stored as nothing rather than as a guess.
 */
function parsePriceRange(text) {
  const numbers = String(text ?? "").match(/\d+(?:\.\d+)?/g);
  if (!numbers?.length) return { target_price_min_cents: null, target_price_max_cents: null };
  const [low, high = low] = numbers;
  return {
    target_price_min_cents: toCents(low),
    target_price_max_cents: toCents(high),
  };
}

export default function LiveBrandOnboarding({ org, user, onComplete }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({});
  const [terms, setTerms] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const kinds = useMemo(
    () => [...new Set([...Object.values(KIND_FOR_LABEL), CATEGORY_KIND])],
    [],
  );

  // Vocabulary first, then whatever this org already answered. Resuming is the
  // point of saving per step, so the screen has to come back filled in.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [byKind, selected, existing] = await Promise.all([
          listTermsByKind(kinds),
          getSelectedTerms("brand_profile", org.id),
          supabase.from("brand_profiles").select("*").eq("org_id", org.id).maybeSingle(),
        ]);
        if (cancelled) return;

        setTerms(byKind);

        const profile = existing.data ?? {};
        const restored = {};
        for (const [label, column] of Object.entries(COLUMN_FOR_LABEL)) {
          if (profile[column] != null) restored[onboardingFieldName(label)] = String(profile[column]);
        }
        // Links come back as term ids; the design speaks in labels.
        for (const [label, kind] of Object.entries(KIND_FOR_LABEL)) {
          const ids = selected?.[kind] ?? [];
          const labels = (byKind[kind] ?? [])
            .filter((term) => ids.includes(term.id))
            .map((term) => termLabel(term));
          if (labels.length) restored[onboardingFieldName(label)] = labels;
        }
        if (profile.brand_category) {
          const term = (byKind[CATEGORY_KIND] ?? []).find((t) => t.slug === profile.brand_category);
          if (term) restored[onboardingFieldName(CATEGORY_LABEL)] = [termLabel(term)];
        }
        setValues(restored);
      } catch (loadError) {
        if (!cancelled) setError(loadError);
      }
    })();

    return () => { cancelled = true; };
  }, [org.id, kinds]);

  /** Options the design would otherwise hardcode, keyed by its own labels. */
  const optionsByLabel = useMemo(() => {
    const map = {};
    for (const [label, kind] of Object.entries(KIND_FOR_LABEL)) {
      const list = terms[kind];
      if (list?.length) map[label] = list.map((term) => termLabel(term));
    }
    const categories = terms[CATEGORY_KIND];
    if (categories?.length) map[CATEGORY_LABEL] = categories.map((term) => termLabel(term));
    return map;
  }, [terms]);

  /** A label the design shows, back to the term row it came from. */
  const termsFor = useCallback(
    (kind, labels) =>
      (terms[kind] ?? [])
        .filter((term) => labels.includes(termLabel(term)))
        .map((term) => term.id),
    [terms],
  );

  async function persist(submitted) {
    const patch = {};
    const links = [];

    for (const [label, column] of Object.entries(COLUMN_FOR_LABEL)) {
      const raw = submitted[onboardingFieldName(label)];
      if (raw === undefined) continue;
      const trimmed = typeof raw === "string" ? raw.trim() : raw;
      patch[column] = trimmed === "" ? null : NUMERIC_COLUMNS.has(column) ? Number(trimmed) : trimmed;
    }

    const price = submitted[onboardingFieldName("Typical price range for core styles")];
    if (price !== undefined) Object.assign(patch, parsePriceRange(price));

    for (const [label, kind] of Object.entries(KIND_FOR_LABEL)) {
      const chosen = submitted[onboardingFieldName(label)];
      if (chosen === undefined) continue;
      links.push({ kind, termIds: termsFor(kind, chosen) });
    }

    const category = submitted[onboardingFieldName(CATEGORY_LABEL)];
    if (category !== undefined) {
      const term = (terms[CATEGORY_KIND] ?? []).find((t) => category.includes(termLabel(t)));
      patch.brand_category = term?.slug ?? null;
    }

    if (Object.keys(patch).length) await saveBrandProfile(org.id, patch);

    // One kind at a time: a blanket delete of an entity's links would wipe the
    // groups this step never showed.
    for (const { kind, termIds } of links) {
      await setLinks({ subjectType: "brand_profile", subjectId: org.id, orgId: org.id, kind, termIds });
    }
  }

  async function next(submitted = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await persist(submitted);
      setValues((current) => ({ ...current, ...submitted }));

      const signature = submitted[onboardingFieldName("Signature")];
      if (signature) {
        unwrap(
          await supabase.from("terms_acceptances").insert({
            org_id: org.id,
            terms_version: TERMS_VERSION,
            signature: String(signature).trim(),
            accepted_by: user.id,
          }),
          "record your agreement",
        );
      }

      const stakeholders = submitted[onboardingFieldName("Decision makers")] ?? [];
      for (const email of stakeholders) {
        if (String(email).includes("@")) await inviteMember(org.id, String(email));
      }

      // The last designed card is "You're all set"; leaving it is what ends
      // onboarding, so the profile is marked complete on the way in.
      if (step === LAST_STEP - 1) await completeOnboarding(org.id, "brand");
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
    <BrandOnboarding
      step={step}
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
