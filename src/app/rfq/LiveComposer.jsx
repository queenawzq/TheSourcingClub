/**
 * The request composer, on Queena's designed flow.
 *
 * `DescribeScreen`, `ReviewScreen` and `FlowShell` all come from
 * src/prototype/main.jsx — the journey rail, the eyebrow, the right rail and
 * the bottom bar are hers, unchanged. This file is the seam.
 *
 * The flow the design draws is: say what you need in free text, let the model
 * draft a brief from it, then read the draft back and correct anything it got
 * wrong. "Skip AI" is in the design too, and it matters — it is the path when
 * the model is off or wrong, and it is why the review fields have to be
 * editable rather than read-only.
 *
 * The draft row exists before a single field is filled. Review edits are
 * persisted by the explicit Save changes action or while advancing to Invite
 * vendors; attachment uploads persist immediately.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DescribeScreen, FlowShell, InviteScreen, InviteSuccessScreen, ReviewScreen } from "../../prototype/main.jsx";
import LiveBrandFactoryProfile from "../profile/LiveBrandFactoryProfile.jsx";
import { attachDocumentToRfq, createDraftRfq, getColourSplits, getQuestions, getRfq, matchScoresForRfq, publishRfq, saveRfq, setColourSplits, setInvitations, setQuestions } from "../../lib/domain/rfq.js";
import { deleteDocument, listRfqDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { getOrder } from "../../lib/domain/order.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { briefGenerationEnabled, generateBrief } from "../../lib/domain/brief.js";
import { categoryTermIds, fieldsFromBrief, fillBlanks, quantityLine } from "./brief-fields.js";
import { addCustomTerm, listLinks, listTermsByKind, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { linkedLabels, mentionsLabel, monthLine, quantityLine as resumedQuantityLine, sourcingChoice } from "./resume-fields.js";
import { toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const KINDS = ["product_category", "certification", "region", "service", "sourcing_responsibility"];

/** "$18-$24" → 1800 / 2400. Unreadable text stores nothing rather than a guess. */
function priceRange(text) {
  const numbers = String(text ?? "").match(/\d+(?:\.\d+)?/g);
  if (!numbers?.length) return { target_unit_price_min_cents: null, target_unit_price_max_cents: null };
  const [low, high = low] = numbers;
  return { target_unit_price_min_cents: toCents(low), target_unit_price_max_cents: toCents(high) };
}

/**
 * "300 units total · 3 colors, 100 each" → three rows of 100.
 *
 * The design collapses the colour breakdown into one line; the schema keeps it
 * as rows, because a vendor quotes per colour. Parsed rather than dropped, and
 * dropped rather than guessed: an unreadable line stores no rows and the total
 * quantity still stands on its own.
 */
function colourSplitsFrom(text) {
  const colours = String(text ?? "").match(/(\d+)\s*colou?rs?/i);
  const each = String(text ?? "").match(/(\d[\d,]*)\s*(?:units\s*)?each/i);
  if (!colours || !each) return [];
  const count = Number(colours[1]);
  const per = Number(each[1].replace(/,/g, ""));
  if (!count || !per || count > 24) return [];
  return Array.from({ length: count }, (_, index) => ({
    colour: `Colour ${index + 1}`,
    quantity: per,
  }));
}

/** The design's four choices, onto the three the taxonomy has. */
const SOURCING_SLUG = {
  full: "factory-sources",
  partial: "mixed",
  "brand-provided": "brand-supplies",
  unsure: "unsure",
};

/**
 * A month from "Sample in August, bulk by late September".
 *
 * The design asks for a timeline in prose; capacity matching needs the first
 * of a month. Read when a month name is in there, null when it is not —
 * matching without a delivery month is weaker, but a guessed month is wrong
 * in a way nobody sees.
 */
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function deliveryMonthFrom(text) {
  const lower = String(text ?? "").toLowerCase();
  let found = -1;
  let at = Infinity;
  MONTHS.forEach((name, index) => {
    const position = lower.lastIndexOf(name);
    if (position >= 0 && position <= at) { at = position; found = index; }
  });
  if (found < 0) return null;
  const year = Number((lower.match(/\b(20\d{2})\b/) ?? [])[1]) || new Date().getFullYear();
  return `${year}-${String(found + 1).padStart(2, "0")}-01`;
}

/** A stored end-of-day timestamp back into the calendar's local date. */
function datePickerValue(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const day = new Date(value);
  if (Number.isNaN(day.getTime())) return "";
  return [
    day.getFullYear(),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * The quote deadline, from what the brand typed.
 *
 * The calendar supplies an ISO date. The legacy prose formats remain readable
 * so existing drafts and older tests can still be saved without losing their
 * deadline. Whatever the input form, store the END of that local day.
 */
export function quoteDeadlineFrom(text, now = new Date()) {
  const said = String(text ?? "").trim();
  if (!said) return { value: null };
  const endOf = (day) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);

  const span = said.match(/(\d+)\s*(business|working)?\s*days?/i);
  const iso = said.match(/(\d{4})-(\d{2})-(\d{2})/);
  const named = said.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  let day = null;

  if (iso) {
    day = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  } else if (named && MONTHS.some((month) => month.startsWith(named[1].toLowerCase().slice(0, 3)))) {
    const month = MONTHS.findIndex((name) => name.startsWith(named[1].toLowerCase().slice(0, 3)));
    const year = named[3] ? Number(named[3]) : now.getFullYear();
    day = new Date(year, month, Number(named[2]));
    // "Oct 20" in November means next year's.
    if (!named[3] && endOf(day) < now) day = new Date(year + 1, month, Number(named[2]));
  } else if (span) {
    day = new Date(now);
    let left = Number(span[1]);
    while (left > 0) {
      day.setDate(day.getDate() + 1);
      if (!span[2] || (day.getDay() !== 0 && day.getDay() !== 6)) left -= 1;
    }
  }

  if (!day || Number.isNaN(day.getTime())) {
    return { error: `Could not read "${said}" as a quote deadline. Try a date such as Oct 20, 2026, or "5 business days".` };
  }
  if (endOf(day) < now) {
    return { error: "The quote deadline has already passed. Vendors could not quote at all." };
  }
  return { value: endOf(day).toISOString() };
}

const firstNumber = (text) => {
  const match = String(text ?? "").match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
};

/**
 * The invite step's "Filters preselected from your request" chips, read from
 * the request itself: category, the quantity as an MOQ ceiling,
 * certifications and regions. Blank fields give no chip.
 */
export function requestFilters(values) {
  const text = (key) => String(values[key] ?? "").trim();
  const quantity = firstNumber(values.quantity);
  return [
    text("category"),
    quantity ? `MOQ ≤ ${quantity.toLocaleString("en-US")}` : "",
    text("certifications"),
    text("services"),
    text("regions").split(/\s*(?:,|\/|\bor\b|\band\b)\s*/i).filter(Boolean).join(" / "),
  ].filter(Boolean);
}

export default function LiveComposer({ org, rfqId }) {
  const { navigate } = useRouter();
  const [step, setStep] = useState(rfqId ? "review" : "describe");
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const inviteEntryHandled = useRef(false);
  const [draftId, setDraftId] = useState(rfqId ?? null);
  const [freeText, setFreeText] = useState("");
  const [values, setValues] = useState({});
  const [terms, setTerms] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [selectedVendors, setSelectedVendors] = useState([]);
  // The design's own toggle, ticked by default exactly as it is drawn.
  const [openToAll, setOpenToAll] = useState(true);
  // Who the request actually went to, for the success card's copy.
  const [invited, setInvited] = useState([]);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState("saved");
  // A reorder: the order this draft repeats, and its factory, which the
  // invite step ticks once (and only once, so unticking it sticks).
  const [reorder, setReorder] = useState(null);
  const preselected = useRef(false);
  // "Request quote" on a vendor's profile opens a new request with that
  // vendor ticked the same way (`/rfqs/new?invite=<org id>`).
  const [requestedVendor] = useState(() => (rfqId ? null : new URLSearchParams(window.location.search).get("invite")));
  // A vendor's profile, opened from the invite step: shown in place of it, so
  // the selection survives the visit.
  const [profileOf, setProfileOf] = useState(null);

  const kinds = useMemo(() => KINDS, []);

  useEffect(() => {
    listTermsByKind(kinds).then(setTerms).catch(setError);
  }, [kinds]);

  // Resume an existing draft rather than starting a second one. Everything
  // the review card shows is read back, in the words its parsers read: a
  // field left blank here is saved blank by toInvite(), and its links deleted.
  useEffect(() => {
    if (!rfqId) return;
    Promise.all([getRfq(rfqId), listLinks("rfq", rfqId), getColourSplits(rfqId), getQuestions(rfqId), listTermsByKind(kinds)])
      .then(async ([row, linked, splits, questions, byKind]) => {
        if (!row) return;
        setFreeText(row.brief ?? "");
        setValues({
          title: row.title ?? "",
          quantity: resumedQuantityLine(row.quantity_total, splits),
          material: row.material_notes ?? "",
          samples: row.sample_notes ?? "",
          timeline: monthLine(row.target_delivery_month),
          price: row.target_unit_price_min_cents
            ? `$${(row.target_unit_price_min_cents / 100).toFixed(0)}-$${((row.target_unit_price_max_cents ?? row.target_unit_price_min_cents) / 100).toFixed(0)}`
            : "",
          category: linkedLabels(linked, byKind.product_category),
          certifications: linkedLabels(linked, byKind.certification),
          services: linkedLabels(linked, byKind.service),
          regions: linkedLabels(linked, byKind.region),
          sourcing: sourcingChoice(row.sourcing_responsibility_term_id, byKind.sourcing_responsibility, SOURCING_SLUG),
          sourcingDetails: row.sourcing_details ?? "",
          additionalDetails: row.additional_details ?? "",
          // Read back as the date it is, so saving again parses the same way.
          deadline: datePickerValue(row.quote_deadline),
          vendorQuestions: questions.map((question) => question.prompt).join("\n"),
        });
        // A reorder leaves the delivery month blank on purpose: the last run's
        // is most likely past, so the brief must not fill it back in.
        const fromBrief = fieldsFromBrief(row.brief, byKind.product_category, byKind);
        if (row.reorder_of_order_id) delete fromBrief.timeline;
        setValues((current) => fillBlanks(current, fromBrief));
        setSaveState("saved");

        if (row.reorder_of_order_id) {
          // Read under RLS: an order this brand is not on comes back empty,
          // and the draft is then just a draft.
          const order = await getOrder(row.reorder_of_order_id);
          if (order) {
            setReorder({
              title: order.rfqs?.title ?? "this order",
              factoryOrgId: order.factory_org_id,
              factoryName: order.factory?.name ?? "the factory",
            });
            // A repeat goes to the factory that made it, not to everyone.
            setOpenToAll(false);
          }
        }
        setResumeLoaded(true);
      })
      .catch(setError);
  }, [rfqId, kinds]);

  useEffect(() => {
    if (!resumeLoaded || inviteEntryHandled.current || !window.location.pathname.endsWith("/invite")) return;
    inviteEntryHandled.current = true;
    // Returning from quotes only loads vendors; it must not rewrite the brief.
    toInvite({ skipSave: true });
  }, [resumeLoaded]);

  // The category, certifications and regions are matched against the term
  // labels, which load on their own and may arrive after a resumed draft does.
  useEffect(() => {
    if (step !== "review" || !terms.product_category?.length || !freeText) return;
    const { category, certifications, regions } = fieldsFromBrief(freeText, terms.product_category, terms);
    setValues((current) => fillBlanks(current, { category, certifications, regions }));
  }, [step, terms, freeText]);

  // The request's files, so a resumed draft shows what is already attached.
  useEffect(() => {
    if (!draftId) return;
    listRfqDocuments(draftId).then(setFiles).catch(() => {});
  }, [draftId]);

  /**
   * Attach files to the request.
   *
   * Every file here is filed as a tech pack in the PRIVATE bucket, under the
   * request's id: a brand's unreleased sketches must never land in the public
   * bucket, and the request in the path is what lets an invited vendor open
   * them (see migration 063). The kind only decides the bucket and the policy.
   */
  async function addFiles(picked) {
    if (!draftId || uploading) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of picked) {
        const document = await uploadDocument({ orgId: org.id, kind: "tech_pack", file, scopeId: draftId });
        await attachDocumentToRfq(document.id, draftId);
      }
      setFiles(await listRfqDocuments(draftId));
    } catch (failure) {
      setError(failure);
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(file) {
    setError(null);
    try {
      await deleteDocument(file);
      setFiles((current) => current.filter((candidate) => candidate.id !== file.id));
    } catch (failure) {
      setError(failure);
    }
  }

  const change = useCallback((name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setSaveState("dirty");
  }, []);

  /**
   * The model's answer, in the review card's own words. It returns taxonomy
   * slugs and numbers; the card shows labels and prose the save step parses.
   */
  function fromModel(fields) {
    if (!fields) return {};
    const labels = (kind, slugs) => (slugs ?? [])
      .map((slug) => (terms[kind] ?? []).find((term) => term.slug === slug))
      .filter(Boolean)
      .map((term) => termLabel(term))
      .join(", ");
    const splits = fields.colour_splits ?? [];
    const evenly = splits.length > 0 && splits.every((split) => split.quantity === splits[0].quantity);
    const total = fields.quantity_total ?? (splits.length ? splits.reduce((sum, split) => sum + split.quantity, 0) : null);
    const low = fields.target_unit_price_min;
    const high = fields.target_unit_price_max ?? low;
    return {
      title: fields.title ?? "",
      // As specific as the brief ("Womenswear / woven shirting"), not just
      // the taxonomy's "Tops"; the save step links the terms from it.
      category: fields.product_type || labels("product_category", fields.product_category_slugs),
      quantity: quantityLine(total, evenly ? splits.length : null),
      material: fields.material_notes ?? "",
      samples: fields.sample_notes ?? "",
      price: low ? (high && high !== low ? `$${low}–$${high}` : `$${low}`) : "",
      certifications: labels("certification", fields.certification_slugs),
      regions: labels("region", fields.region_slugs),
    };
  }

  /**
   * Leave the describe step.
   *
   * The draft row is created here, before anything is drafted or typed, so a
   * closed tab loses nothing. The model is asked only if it is switched on;
   * "Skip AI" lands on the same review card with empty fields.
   */
  async function fromDescribe(useModel) {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const id = draftId ?? (await createDraftRfq(org.id)).id;
      setDraftId(id);
      await saveRfq(id, { brief: freeText || null });

      let fields = null;
      if (useModel && briefGenerationEnabled && freeText.trim()) {
        ({ fields } = await generateBrief({ freeText, terms }));
      }
      // The model's reading first, then whatever the text itself says for
      // what is still blank — with the model off, skipped or failed, the card
      // still opens with the brief's own facts rather than empty fields.
      setValues((current) => fillBlanks(fillBlanks(current, fromModel(fields)), fieldsFromBrief(freeText, terms.product_category, terms)));
      setSaveState("dirty");

      setStep("review");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  /** Persist every editable field on the review card without navigating. */
  async function persistReview() {
    const deadline = quoteDeadlineFrom(values.deadline);
    if (deadline.error) throw new Error(deadline.error);

    await saveRfq(draftId, {
        title: values.title?.trim() || values.category?.trim() || "Untitled request",
        quote_deadline: deadline.value,
        brief: freeText || null,
        quantity_total: firstNumber(values.quantity),
        material_notes: values.material?.trim() || null,
        sample_notes: values.samples?.trim() || null,
        sourcing_details: values.sourcingDetails?.trim() || null,
        additional_details: values.additionalDetails?.trim() || null,
        target_delivery_month: deliveryMonthFrom(values.timeline),
        sourcing_responsibility_term_id:
          (terms.sourcing_responsibility ?? []).find((term) => term.slug === SOURCING_SLUG[values.sourcing ?? "partial"])?.id ?? null,
        ...priceRange(values.price),
    });
    // Category, certifications, services and regions are stored as taxonomy
    // card and stored as taxonomy links, because matching is on slugs. A
    // phrase that matches no term links nothing rather than linking something
    // close.
    const linkKinds = [
      ["product_category", values.category],
      ["certification", values.certifications],
      ["service", values.services],
      ["region", values.regions],
    ];
    for (const [kind, typed] of linkKinds) {
      if (typed === undefined) continue;
      // The category line is prose ("Womenswear / poplin shirts"), so a
      // garment word links its category too.
      let availableTerms = terms[kind] ?? [];
      if (kind === "service") {
        const selectedLabels = String(typed)
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean);
        for (const label of selectedLabels) {
          const exists = availableTerms.some((term) => termLabel(term).toLowerCase() === label.toLowerCase());
          if (!exists) availableTerms = [...availableTerms, await addCustomTerm(org.id, kind, label)];
        }
        setTerms((current) => ({ ...current, service: availableTerms }));
      }
      const termIds = kind === "product_category"
        ? categoryTermIds(typed, terms[kind])
        : availableTerms
          .filter((term) => kind === "service"
            ? String(typed).split(",").some((label) => label.trim().toLowerCase() === termLabel(term).toLowerCase())
            : mentionsLabel(typed, termLabel(term)))
          .map((term) => term.id);
      await setLinks({ subjectType: "rfq", subjectId: draftId, orgId: org.id, kind, termIds });
    }

    const splits = colourSplitsFrom(values.quantity);
    if (splits.length) await setColourSplits(draftId, splits);

    // The brand's own questions, as rows a vendor answers against.
    const questions = String(values.vendorQuestions ?? "")
      .split(/\r?\n/)
      .map((prompt) => prompt.trim())
      .filter(Boolean)
      .map((prompt, index) => ({ prompt, sort: index }));
    await setQuestions(draftId, questions);
  }

  async function saveReview() {
    if (busy || saveState === "saving" || !draftId) return;
    setSaveState("saving");
    setError(null);
    try {
      await persistReview();
      setSaveState("saved");
    } catch (failure) {
      setSaveState("dirty");
      setError(failure);
    }
  }

  /**
   * Leave the review card: save everything, then go and choose vendors.
   *
   * Publishing happens on the invite step rather than here, because that is
   * where the design puts the only control over who can see the request — its
   * "Open to all vendors" toggle. Publishing before it would mean deciding
   * visibility for the brand and then asking them about it.
   */
  async function toInvite({ skipSave = false } = {}) {
    if (busy || saveState === "saving" || !draftId) return;
    setBusy(true);
    setSaveState("saving");
    setError(null);

    try {
      if (!skipSave) await persistReview();
      setSaveState("saved");

      const rows = unwrap(
        await supabase
          .from("factory_profiles")
          .select("org_id, location, moq, typical_lead_days, verification_status, trust_tier, intro, vendor_kind, orgs!inner (id, name)")
          .not("published_at", "is", null)
          .eq("verification_status", "verified")
          .eq("orgs.is_demo", false),
        "load vendors",
      );
      // The design ranks this list by fit. match_score_rfq() answers per
      // pair, so score the vendors actually being shown and sort by it.
      const scores = await matchScoresForRfq(draftId, (rows ?? []).map((row) => row.org_id));
      const vendorTerms = await listTermsByKind(["make", "product_category", "specialty", "service", "core_service"]);
      const vendorIds = (rows ?? []).map((row) => row.org_id);
      const links = vendorIds.length ? unwrap(await supabase.from("taxonomy_links")
        .select("subject_id, term_id").eq("subject_type", "factory_profile").in("subject_id", vendorIds), "load vendor specialties") : [];
      const images = vendorIds.length ? unwrap(await supabase.from("documents")
        .select("id, org_id, storage_path, file_name, title").in("org_id", vendorIds)
        .eq("kind", "product_image").eq("bucket", "org-public").order("created_at"), "load vendor sample images") : [];
      const cardDetails = new Map((rows ?? []).map((row) => {
        const selected = new Set(links.filter((link) => link.subject_id === row.org_id).map((link) => link.term_id));
        const labels = (kind) => (vendorTerms[kind] ?? []).filter((term) => selected.has(term.id)).map((term) => termLabel(term));
        return [row.org_id, {
          categories: labels("make").length ? labels("make") : labels("product_category"),
          capabilities: [...new Set([...labels("specialty"), ...labels(row.vendor_kind === "trading_company" ? "core_service" : "service")])],
          products: images.filter((image) => image.org_id === row.org_id).map((image) => ({
            // Captioned by the vendor's title only, never the file name.
            id: image.id, name: image.title ?? "",
            image: supabase.storage.from("org-public").getPublicUrl(image.storage_path).data.publicUrl,
          })),
        }];
      }));
      const firstId = reorder?.factoryOrgId ?? requestedVendor;
      const first = firstId && (rows ?? []).find((row) => row.org_id === firstId);
      if (firstId && !preselected.current) {
        preselected.current = true;
        if (first) {
          setSelectedVendors((current) => (current.includes(first.orgs?.name) ? current : [...current, first.orgs?.name]));
        }
      }
      setVendors(
        (rows ?? [])
          .map((row) => ({ ...row, ...cardDetails.get(row.org_id), matchPercent: scores.get(row.org_id) ?? null }))
          .sort((a, b) => (b.matchPercent ?? -1) - (a.matchPercent ?? -1))
          // A reorder's own factory (or the vendor the request was started
          // from) heads the list, ticked, above the ranking.
          .sort((a, b) => Number(b.org_id === firstId) - Number(a.org_id === firstId)),
      );
      setStep("invite");
    } catch (failure) {
      setSaveState("dirty");
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  /** Publish, with the visibility the design's toggle expresses. */
  async function publish() {
    if (busy || !draftId) return;
    setBusy(true);
    setError(null);

    try {
      // Publish first, then invite. An invitation to a draft is refused by
      // RLS — reasonably, since a draft is the brand's private working copy
      // and nobody outside it may be pointed at one.
      await publishRfq(draftId, openToAll ? "open_to_all" : "invited_only");

      const chosen = vendors
        .filter((vendor) => selectedVendors.includes(vendor.orgs?.name))
        .map((vendor) => vendor.org_id);
      if (chosen.length) await setInvitations(draftId, chosen);
      setInvited(selectedVendors.filter((name) => vendors.some((vendor) => vendor.orgs?.name === name)));
      // The design's "Quote request sent" step, rather than dropping the brand
      // on the request page with no word that anything was sent.
      setStep("success");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (step === "describe") {
    return (
      <FlowShell screen="describe">
        <DescribeScreen
          value={freeText}
          onValueChange={setFreeText}
          onContinue={() => fromDescribe(true)}
          onSkip={() => fromDescribe(false)}
          busy={busy}
          error={error}
          modelEnabled={briefGenerationEnabled}
        />
      </FlowShell>
    );
  }

  if (step === "success") {
    return (
      <FlowShell
        screen="inviteSuccess"
        canBack={false}
        onNext={() => navigate(`/rfqs/${draftId}/quotes`)}
        // The request as it was saved, not the design's example shirt.
        rail={{
          summary: [
            ["Product", values.title?.trim() || values.category?.trim()],
            ["Quantity", values.quantity?.trim()],
            ["Samples", values.samples?.trim()],
            ["Target", values.price?.trim()],
          ],
        }}
      >
        <InviteSuccessScreen
          selectedFactories={invited}
          openToAll={openToAll}
          goTo={(next) => navigate(next === "quotes" ? `/rfqs/${draftId}/quotes` : "/")}
        />
      </FlowShell>
    );
  }

  if (step === "invite" && profileOf) {
    const vendor = vendors.find((item) => item.org_id === profileOf);
    const close = () => {
      setProfileOf(null);
      window.scrollTo({ top: 0 });
    };
    return (
      <LiveBrandFactoryProfile
        org={org}
        vendorOrgId={profileOf}
        from="invite"
        onBack={close}
        // Already requesting: "Request quote" ticks this vendor and goes back.
        onRequestQuote={() => {
          const name = vendor?.orgs?.name;
          if (name) setSelectedVendors((current) => (current.includes(name) ? current : [...current, name]));
          close();
        }}
      />
    );
  }

  if (step === "invite") {
    const shaped = vendors.map((vendor) => ({
      initials: (vendor.orgs?.name ?? "?").slice(0, 2).toUpperCase(),
      name: vendor.orgs?.name ?? "Vendor",
      location: vendor.location ?? "Location not given",
      // There is no "unverified" badge: an unverified vendor has none.
      trust: vendor.verification_status === "verified" ? (vendor.trust_tier ?? "basic") : "",
      // Scored against this request by match_score_rfq(); blank when the
      // vendor's profile has too little in it to score.
      fit: vendor.matchPercent === null ? "" : `${vendor.matchPercent}%`,
      // Nothing records a rating or a vendor's order count a brand may read;
      // "" tells the card to leave both out rather than print an example.
      rating: "",
      orders: "",
      fitType: vendor.vendor_kind === "trading_company" ? "Trading company" : "Factory",
      fitSummary: vendor.intro ?? "",
      factoryNote: "",
      lead: vendor.typical_lead_days ? `${vendor.typical_lead_days} days` : "",
      quoteQuantity: vendor.moq ? `MOQ ${vendor.moq}` : "",
      materialCosts: [],
      samples: [],
      // The card renders a stats grid and a product strip. Both come from the
      // vendor's own profile; an empty list renders an empty strip, which is
      // honest, where an absent one crashes the card.
      stats: [
        ["MOQ", vendor.moq ? `${vendor.moq}/style` : "—"],
        ["Lead time", vendor.typical_lead_days ? `${vendor.typical_lead_days} days` : "—"],
        ["Location", vendor.location ?? "—"],
        ["Status", vendor.verification_status === "verified" ? "Verified" : "Unverified"],
      ],
      products: vendor.products ?? [],
      categories: vendor.categories ?? [],
      capabilities: vendor.capabilities ?? [],
      notes: vendor.intro ? [vendor.intro] : [],
      // No intro, no note box (QA, Oct 5: an empty box under the stats).
      note: vendor.intro || null,
      profileHref: `/app.html/factories/${vendor.org_id}?from=invite`,
      onOpenProfile: () => {
        setProfileOf(vendor.org_id);
        window.scrollTo({ top: 0 });
      },
    }));

    return (
      <FlowShell
        screen="invite"
        canBack
        busy={busy}
        centerText={`${selectedVendors.length} selected · ${shaped.length} available`}
        onBack={() => setStep("review")}
        onNext={publish}
      >
        <InviteScreen
          vendors={shaped}
          filters={requestFilters(values)}
          selectedFactories={selectedVendors}
          setSelectedFactories={setSelectedVendors}
          openToAll={openToAll}
          onOpenToAllChange={setOpenToAll}
        />
        {reorder && !vendors.some((vendor) => vendor.org_id === reorder.factoryOrgId) && (
          <p className="composer-note" data-testid="reorder-unlisted">
            {reorder.factoryName} is not listed on TSC right now, so it cannot be invited. Open the request to all vendors or choose another.
          </p>
        )}
        {error && <p className="composer-error" role="alert">{error.message}</p>}
      </FlowShell>
    );
  }

  return (
    <FlowShell
      screen="review"
      canBack
      busy={busy}
      onBack={() => setStep("describe")}
      onNext={toInvite}
      primaryDisabled={saveState === "saving"}
      secondaryAction={{
        label: saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save changes",
        onClick: saveReview,
        disabled: busy || saveState === "saving" || saveState === "saved",
      }}
    >
      {reorder && (
        <p className="composer-note" data-testid="reorder-note">
          Reordering {reorder.title} with {reorder.factoryName}. Check the details, then invite.
        </p>
      )}
      <ReviewScreen
        brief={freeText}
        values={values}
        onChange={change}
        onEditBrief={() => setStep("describe")}
        attachments={files}
        onAddFiles={addFiles}
        onRemoveFile={removeFile}
        uploading={uploading}
        serviceOptions={(terms.service ?? []).map((term) => termLabel(term))}
      />
      {error && <p className="composer-error" role="alert">{error.message}</p>}
    </FlowShell>
  );
}
