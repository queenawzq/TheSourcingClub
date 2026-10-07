/**
 * The factory's own profile, on Queena's designed page
 * (`FactoryManufacturingProfilePage`), with the factory's real records behind
 * it: what onboarding saved, its capacity, documents and orders.
 *
 * Everything is the factory reading its own rows, so no new access rule is
 * involved. The edit dialogs arrive separately; until then the page leaves
 * out the buttons that would open them.
 */
import React, { useEffect, useState } from "react";
import { FactoryManufacturingProfilePage } from "../../factory-prototype/main.jsx";
import { getFactoryProfile, getSelectedTerms } from "../../lib/domain/profile.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { getCapacity } from "../../lib/domain/capacity-store.js";
import { listDocuments, urlFor } from "../../lib/domain/documents.js";
import { listOrders } from "../../lib/domain/order.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { CHIP_KINDS, factoryProfileView, titleFromFileName } from "./factory-profile-view.js";
import "./profile.css";

const KINDS = [...Object.values(CHIP_KINDS), "capacity_category", "certification"];

/** Every record the page draws, loaded side by side. */
async function loadParts(org) {
  const [profile, terms, selected, capacity, references, certificationRows, registrations, logos, samples, walkthroughs, orders] =
    await Promise.all([
      getFactoryProfile(org.id),
      listTermsByKind(KINDS),
      getSelectedTerms("factory_profile", org.id),
      getCapacity(org.id),
      supabase.from("profile_references").select("id, title, sort").eq("org_id", org.id).order("sort")
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

export default function LiveFactoryProfile({ org }) {
  const [state, setState] = useState({ live: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ live: null, error: null });
    loadParts(org).then(
      (parts) => !cancelled && setState({ live: factoryProfileView(parts), error: null }),
      (error) => !cancelled && setState({ live: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id, org.name]);

  if (state.error) {
    return (
      <main className="factory-profile-page">
        <p className="live-profile-error" role="alert">Couldn't load your profile: {state.error.message}</p>
      </main>
    );
  }
  if (!state.live) {
    return (
      <main className="factory-profile-page">
        <p className="live-profile-loading">Loading your profile…</p>
      </main>
    );
  }
  return <FactoryManufacturingProfilePage live={state.live} />;
}
