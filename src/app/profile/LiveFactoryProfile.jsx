/**
 * The factory's own profile, on Queena's designed page
 * (`FactoryManufacturingProfilePage`), with the factory's real records behind
 * it: what onboarding saved, its capacity, documents and orders. Its edit
 * dialogs save through factory-profile-save.js, and "See details" opens the
 * designed completion page (`FactoryProfileCompletionPage`) on the same data.
 *
 * Everything is the factory reading and writing its own rows, so no new access
 * rule is involved.
 */
import React, { useCallback, useEffect, useState } from "react";
import { FactoryManufacturingProfilePage, FactoryProfileCompletionPage } from "../../factory-prototype/main.jsx";
import { getFactoryProfile, getSelectedTerms } from "../../lib/domain/profile.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { getCapacity } from "../../lib/domain/capacity-store.js";
import { listDocuments, urlFor } from "../../lib/domain/documents.js";
import { listOrders } from "../../lib/domain/order.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { useRouter } from "../../lib/router.jsx";
import {
  CHIP_KINDS,
  bookingMonths,
  factoryProfileEditForm,
  factoryProfileEditOptions,
  factoryProfileView,
  titleFromFileName,
} from "./factory-profile-view.js";
import { SAVED_EDITORS, saveProfileSection } from "./factory-profile-save.js";
import "./profile.css";

// `country` lets a saved location carry its country code, as onboarding does.
const KINDS = [...Object.values(CHIP_KINDS), "capacity_category", "certification", "country"];

/** Every record the page draws, loaded side by side. */
async function loadParts(org) {
  const [profile, terms, selected, capacity, references, certificationRows, registrations, logos, samples, walkthroughs, orders] =
    await Promise.all([
      getFactoryProfile(org.id),
      listTermsByKind(KINDS),
      getSelectedTerms("factory_profile", org.id),
      getCapacity(org.id),
      supabase.from("profile_references").select("id, title, counterparty, sort").eq("org_id", org.id).order("sort")
        .then((result) => unwrap(result, "load your client references")),
      supabase.from("factory_certifications").select("id, term_id, status, document_id").eq("org_id", org.id).order("created_at")
        .then((result) => unwrap(result, "load your certifications")),
      listDocuments(org.id, "business_registration"),
      listDocuments(org.id, "logo"),
      listDocuments(org.id, "product_image"),
      listDocuments(org.id, "walkthrough"),
      listOrders(org.id),
    ]);

  const certificationTerms = terms.certification ?? [];
  const [logoUrl, sampleImages, walkthrough] = await Promise.all([
    logos[0] ? urlFor(logos[0], 3600) : null,
    // listDocuments is newest first; the design reads its samples in the
    // order they were added.
    Promise.all([...samples].reverse().map(async (doc) => ({ title: titleFromFileName(doc.file_name), src: await urlFor(doc, 3600) }))),
    walkthroughs[0] ? urlFor(walkthroughs[0], 3600).then((url) => ({ ...walkthroughs[0], url })) : null,
  ]);

  return {
    orgName: org.name,
    profile,
    terms,
    selected,
    capacity,
    references,
    certifications: certificationRows
      .map((row) => {
        const term = certificationTerms.find((item) => item.id === row.term_id);
        return term ? { name: termLabel(term), status: row.status, hasFile: Boolean(row.document_id) } : null;
      })
      .filter(Boolean),
    registrationDoc: registrations[0] ?? null,
    logoUrl,
    samples: sampleImages,
    walkthrough,
    // Only the orders this factory makes: a person in both a brand and a
    // factory org gets the active org's side.
    orders: orders.filter((order) => order.factory_org_id === org.id),
  };
}

/** The page's data, and a reload that keeps the page up while it fetches. */
function useProfileParts(org) {
  const [state, setState] = useState({ parts: null, error: null });

  const reload = useCallback(async () => {
    const parts = await loadParts(org);
    setState({ parts, error: null });
    return parts;
  }, [org.id, org.name]);

  useEffect(() => {
    let cancelled = false;
    setState({ parts: null, error: null });
    loadParts(org).then(
      (parts) => !cancelled && setState({ parts, error: null }),
      (error) => !cancelled && setState({ parts: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id, org.name]);

  return { ...state, reload };
}

function Waiting({ error }) {
  return (
    <main className="factory-profile-page">
      {error
        ? <p className="live-profile-error" role="alert">Couldn't load your profile: {error.message}</p>
        : <p className="live-profile-loading">Loading your profile…</p>}
    </main>
  );
}

/**
 * `page`: "profile" (the default) or "completion". `editor`, on the profile,
 * opens that dialog on arrival (the completion page's buttons link to
 * /profile/edit/<editor>).
 */
export default function LiveFactoryProfile({ org, page = "profile", editor = null }) {
  const { navigate } = useRouter();
  const { parts, error, reload } = useProfileParts(org);

  if (!parts) return <Waiting error={error} />;

  const view = factoryProfileView(parts);

  if (page === "completion") {
    const verified = parts.profile?.verification_status === "verified";
    return (
      <FactoryProfileCompletionPage
        onBack={() => navigate("/profile")}
        live={{
          percent: view.status.percent,
          intro: verified
            ? "You can receive matching RFQs now. Complete the items below to improve trust signals and help brands understand the factory faster."
            : "Brands can see your profile now. Quoting opens once your business registration is approved. Complete the items below to help brands understand the factory faster.",
          summaryLabel: "Complete",
          checks: view.checks.map((check) => ({
            ...check,
            // A button only where the dialog that fixes it is live.
            action: check.action && SAVED_EDITORS.includes(check.action.editor)
              ? { label: check.action.label, onClick: () => navigate(`/profile/edit/${check.action.editor}`) }
              : null,
          })),
          suggestions: view.checks.filter((check) => check.suggestion).map((check) => check.suggestion),
        }}
      />
    );
  }

  return (
    <FactoryManufacturingProfilePage
      // A fresh page per dialog link, so following one from the completion
      // page opens it even if the profile was already showing.
      key={editor ?? "profile"}
      onViewCompletion={() => navigate("/profile/completion")}
      live={{
        ...view,
        editors: SAVED_EDITORS,
        initialEditor: editor,
        form: factoryProfileEditForm(parts),
        options: factoryProfileEditOptions(parts.terms),
        months: bookingMonths(),
        onSave: async (section, form) => {
          await saveProfileSection(org, section, form, parts);
          await reload();
        },
        // Leave a dialog's own address once it closes, so a refresh shows the
        // profile rather than reopening it.
        onEditorClosed: () => editor && navigate("/profile", { replace: true }),
      }}
    />
  );
}
