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
 * The mapping in brand-profile-fields.js (shared with the brand profile's
 * edit dialogs) is the only place the design's visible labels meet the
 * database's column names. That is deliberate: rename a field in the design
 * and exactly one line changes there.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandOnboarding, onboardingFieldName } from "../../prototype/main.jsx";
import { listTermsByKind, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { completeOnboarding, getSelectedTerms, saveBrandProfile } from "../../lib/domain/profile.js";
import { inviteMember } from "../../lib/domain/org.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import {
  CATEGORY_KIND,
  CATEGORY_LABEL,
  COLUMN_FOR_LABEL,
  KIND_FOR_LABEL,
  NUMERIC_COLUMNS,
  parsePriceRange,
} from "../../lib/domain/brand-profile-fields.js";
import { deleteDocument, listDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { useSignableTerms } from "./useSignableTerms.js";
import { acceptTerms, getTermsAcceptance } from "../../lib/domain/terms.js";
import { termsVersionOf } from "../../lib/domain/legal.js";

/** Uploads on the designed cards → document kind. The kind decides the bucket. */
const UPLOAD_KINDS = {
  "brand-logo": "logo",
  "brand-images": "product_image",
  "brand-business-registration": "business_registration",
};

/** The reverse of UPLOAD_KINDS: document kind → the designed card's field. */
const FIELD_FOR_KIND = Object.fromEntries(
  Object.entries(UPLOAD_KINDS).map(([field, kind]) => [kind, field]),
);

const UPLOADED_FLAG = {
  logo: "uploaded-logo",
  product_image: "uploaded-images",
  business_registration: "uploaded-registration",
};

/** Index of the designed "You're all set" card, the last of the ten. */
const LAST_STEP = 9;

/** Index of the designed terms card. */
const TERMS_STEP = 8;

/** Index of the designed profile review card. */
const REVIEW_STEP = 7;

export default function LiveBrandOnboarding({ org, user, onComplete, onSignOut, initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const [reviewEditStep, setReviewEditStep] = useState(null);
  const [values, setValues] = useState({});
  // Files already in storage, keyed by the designed card's field name. The
  // card lists them with a working Delete; without this it could only say how
  // many there were.
  const [documents, setDocuments] = useState({});
  const [terms, setTerms] = useState({});
  const [termsAcceptance, setTermsAcceptance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const signable = useSignableTerms("terms_brand");

  // Already signed? Looked up by the version on screen, once it has loaded, so
  // a returning company sees its read-only signature rather than a blank one.
  useEffect(() => {
    if (!signable.doc) return undefined;
    let cancelled = false;
    getTermsAcceptance(org.id, termsVersionOf(signable.doc)).then(
      (acceptance) => !cancelled && setTermsAcceptance(acceptance),
      (lookupError) => !cancelled && setError(lookupError),
    );
    return () => { cancelled = true; };
  }, [org.id, signable.doc]);

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
        const [byKind, selected, existing, invitations, ...uploaded] = await Promise.all([
          listTermsByKind(kinds),
          getSelectedTerms("brand_profile", org.id),
          supabase.from("brand_profiles").select("*").eq("org_id", org.id).maybeSingle(),
          supabase.from("org_invitations").select("email, role").eq("org_id", org.id).order("created_at"),
          ...Object.keys(UPLOADED_FLAG).map((kind) => listDocuments(org.id, kind)),
        ]);
        if (cancelled) return;

        setTerms(byKind);

        const profile = existing.data ?? {};
        const restored = {};
        const invitedEmails = (invitations.data ?? []).map((row) => row.email);
        if (invitedEmails.length) restored[onboardingFieldName("Decision makers")] = invitedEmails;
        const byField = {};
        Object.entries(UPLOADED_FLAG).forEach(([kind, flag], index) => {
          if (uploaded[index]?.length) restored[flag] = String(uploaded[index].length);
          byField[FIELD_FOR_KIND[kind]] = uploaded[index] ?? [];
        });
        setDocuments(byField);
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
        // Links first, because they hold the full answer. The column is the
        // fallback for a profile saved before the field became multi-choice.
        const categoryIds = selected?.[CATEGORY_KIND] ?? [];
        const categories = (byKind[CATEGORY_KIND] ?? []).filter((term) => categoryIds.includes(term.id));
        if (categories.length) {
          restored[onboardingFieldName(CATEGORY_LABEL)] = categories.map((term) => termLabel(term));
        } else if (profile.brand_category) {
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

  /**
   * Delete is a real delete: the storage object and the documents row both go.
   * The count the review card reads is kept in step, or the summary keeps
   * claiming a file that is no longer there.
   */
  async function removeDocument(doc) {
    await deleteDocument(doc);
    const field = FIELD_FOR_KIND[doc.kind] ?? Object.keys(UPLOAD_KINDS).find((key) => (documents[key] ?? []).some((row) => row.id === doc.id));
    const kind = UPLOAD_KINDS[field];
    if (!field || !kind) return;
    const fresh = await listDocuments(org.id, kind);
    setDocuments((current) => ({ ...current, [field]: fresh }));
    setValues((current) => ({ ...current, [UPLOADED_FLAG[kind]]: fresh.length ? String(fresh.length) : "" }));
  }

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

    // "Select all that apply". The whole answer goes to taxonomy_links like
    // every other multi-choice group; the column keeps the first choice, which
    // is what the review card, the admin queue and match scoring already read.
    const category = submitted[onboardingFieldName(CATEGORY_LABEL)];
    if (category !== undefined) {
      const chosen = (terms[CATEGORY_KIND] ?? []).filter((t) => category.includes(termLabel(t)));
      patch.brand_category = chosen[0]?.slug ?? null;
      links.push({ kind: CATEGORY_KIND, termIds: chosen.map((t) => t.id) });
    }

    if (Object.keys(patch).length) await saveBrandProfile(org.id, patch);

    const flags = {};
    for (const [field, kind] of Object.entries(UPLOAD_KINDS)) {
      const chosen = submitted[field];
      const files = Array.isArray(chosen) ? chosen : chosen instanceof File ? [chosen] : [];
      for (const file of files) await uploadDocument({ orgId: org.id, kind, file });
      if (files.length) {
        flags[UPLOADED_FLAG[kind]] = String((Number(values[UPLOADED_FLAG[kind]]) || 0) + files.length);
        const fresh = await listDocuments(org.id, kind);
        setDocuments((current) => ({ ...current, [field]: fresh }));
      }
    }
    if (Object.keys(flags).length) setValues((current) => ({ ...current, ...flags }));

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
      // Files are not answers to restore; the upload counts persist() set are.
      const answers = Object.fromEntries(Object.entries(submitted).filter(([key]) => !(key in UPLOAD_KINDS)));
      setValues((current) => ({ ...current, ...answers }));

      const signature = submitted[onboardingFieldName("Signature")];
      if (signature && !termsAcceptance) {
        // The exact version on screen, so the record says what was agreed to.
        const signed = await signable.ensure();
        setTermsAcceptance(await acceptTerms({
          orgId: org.id,
          termsVersion: termsVersionOf(signed),
          legalDocumentId: signed.id,
          signature,
          userId: user.id,
        }));
      }

      // Leaving and returning to this card re-submits the whole list, so only
      // addresses without an invitation yet are invited.
      const stakeholders = submitted[onboardingFieldName("Decision makers")];
      if (stakeholders?.length) {
        const { data: invited } = await supabase.from("org_invitations").select("email").eq("org_id", org.id);
        const already = new Set((invited ?? []).map((row) => row.email));
        for (const email of stakeholders) {
          const address = String(email).trim().toLowerCase();
          if (address.includes("@") && !already.has(address)) await inviteMember(org.id, address);
        }
      }

      if (reviewEditStep !== null) {
        setReviewEditStep(null);
        setStep(REVIEW_STEP);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
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

  /** Save what is on the card, then sign out. A failed save keeps them here. */
  async function saveAndExit(submitted = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const partial = { ...submitted };
      // A signature on its own is not an agreement; leaving is not signing.
      delete partial[onboardingFieldName("Signature")];
      await persist(partial);
      await onSignOut?.();
    } catch (saveError) {
      setError(saveError);
      setBusy(false);
    }
  }

  return (
    <BrandOnboarding
      step={step}
      isReviewEdit={reviewEditStep !== null}
      onBack={() => {
        if (reviewEditStep !== null) {
          setReviewEditStep(null);
          setStep(REVIEW_STEP);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        setStep((current) => Math.max(0, current - 1));
      }}
      onGoToStep={(target) => {
        if (typeof target !== "number" || target >= step) return;
        setReviewEditStep(null);
        setStep(target);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      onNext={next}
      onSaveAndExit={onSignOut ? saveAndExit : undefined}
      onLogout={onSignOut}
      documents={documents}
      onDeleteDocument={removeDocument}
      onEditSection={(target) => {
        if (typeof target !== "number") return;
        setReviewEditStep(target);
        setStep(target);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      optionsByLabel={optionsByLabel}
      values={values}
      termsAcceptance={termsAcceptance}
      busy={busy}
      error={error ?? (step === TERMS_STEP ? signable.error : null)}
      terms={signable.sections}
      fullTerms={signable.full}
      completionPending
    />
  );
}
