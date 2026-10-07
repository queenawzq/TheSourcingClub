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
 * The draft row exists before a single field is filled, so nothing typed is
 * ever held only in component state.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DescribeScreen, FlowShell, InviteScreen, InviteSuccessScreen, ReviewScreen } from "../../prototype/main.jsx";
import { attachDocumentToRfq, createDraftRfq, getRfq, matchScoresForRfq, publishRfq, saveRfq, setColourSplits, setInvitations, setQuestions } from "../../lib/domain/rfq.js";
import { deleteDocument, listRfqDocuments, uploadDocument } from "../../lib/domain/documents.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { briefGenerationEnabled, generateBrief } from "../../lib/domain/brief.js";
import { fieldsFromBrief, fillBlanks, quantityLine } from "./brief-fields.js";
import { listTermsByKind, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const KINDS = ["product_category", "certification", "region", "sourcing_responsibility"];

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
  unsure: null,
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

/**
 * The quote deadline, from what the brand typed.
 *
 * The field is prose in the design ("Jul 24, 2026 · 5 business days after
 * publish"), and nothing was ever saved from it: every live request went out
 * with no deadline, whatever the brand wrote. Read a date ("Oct 20, 2026",
 * "2026-10-20", "Oct 20" meaning the next one) or a span ("5 business days",
 * "10 days") as the END of that day, local time. Unlike the other fields an
 * unreadable deadline is not dropped quietly — it decides when vendors are
 * refused — so it comes back as an error the screen shows.
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

export default function LiveComposer({ org, rfqId }) {
  const { navigate } = useRouter();
  const [step, setStep] = useState(rfqId ? "review" : "describe");
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

  const kinds = useMemo(() => KINDS, []);

  useEffect(() => {
    listTermsByKind(kinds).then(setTerms).catch(setError);
  }, [kinds]);

  // Resume an existing draft rather than starting a second one.
  useEffect(() => {
    if (!rfqId) return;
    getRfq(rfqId)
      .then((row) => {
        if (!row) return;
        setFreeText(row.brief ?? "");
        setValues({
          title: row.title ?? "",
          quantity: row.quantity_total ? String(row.quantity_total) : "",
          material: row.material_notes ?? "",
          samples: row.sample_notes ?? "",
          timeline: row.target_delivery_month ?? "",
          price: row.target_unit_price_min_cents
            ? `$${(row.target_unit_price_min_cents / 100).toFixed(0)}-$${((row.target_unit_price_max_cents ?? row.target_unit_price_min_cents) / 100).toFixed(0)}`
            : "",
          certifications: "",
          regions: "",
          // Read back as the date it is, so saving again parses the same way.
          deadline: row.quote_deadline
            ? new Date(row.quote_deadline).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })
            : "",
          category: "",
        });
        setValues((current) => fillBlanks(current, fieldsFromBrief(row.brief, terms.product_category)));
      })
      .catch(setError);
  }, [rfqId]);

  // The category is matched against the term labels, which load on their own
  // and may arrive after a resumed draft does.
  useEffect(() => {
    if (step !== "review" || !terms.product_category?.length || !freeText) return;
    setValues((current) => fillBlanks(current, { category: fieldsFromBrief(freeText, terms.product_category).category }));
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
      category: labels("product_category", fields.product_category_slugs),
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
      setValues((current) => fillBlanks(fillBlanks(current, fromModel(fields)), fieldsFromBrief(freeText, terms.product_category)));

      setStep("review");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
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
  async function toInvite() {
    if (busy || !draftId) return;
    setBusy(true);
    setError(null);

    try {
      const deadline = quoteDeadlineFrom(values.deadline);
      if (deadline.error) throw new Error(deadline.error);

      await saveRfq(draftId, {
        title: values.title?.trim() || values.category?.trim() || "Untitled request",
        quote_deadline: deadline.value,
        brief: freeText || null,
        quantity_total: firstNumber(values.quantity),
        material_notes: values.material?.trim() || null,
        sample_notes: values.samples?.trim() || null,
        // There is no sourcing_notes column — who sources what is a sentence
        // about the request, so it joins additional_details rather than
        // inventing a column for one textarea.
        additional_details: [values.additionalDetails?.trim(), values.sourcingDetails?.trim()]
          .filter(Boolean)
          .join("\n\n") || null,
        target_delivery_month: deliveryMonthFrom(values.timeline),
        sourcing_responsibility_term_id:
          (terms.sourcing_responsibility ?? []).find((term) => term.slug === SOURCING_SLUG[values.sourcing ?? "partial"])?.id ?? null,
        ...priceRange(values.price),
      });
      // Category, certifications and regions are typed as prose on the review
      // card and stored as taxonomy links, because matching is on slugs. A
      // phrase that matches no term links nothing rather than linking something
      // close.
      const linkKinds = [
        ["product_category", values.category],
        ["certification", values.certifications],
        ["region", values.regions],
      ];
      for (const [kind, typed] of linkKinds) {
        if (typed === undefined) continue;
        const lower = String(typed ?? "").toLowerCase();
        const termIds = (terms[kind] ?? [])
          .filter((term) => lower.includes(termLabel(term).toLowerCase()))
          .map((term) => term.id);
        await setLinks({ subjectType: "rfq", subjectId: draftId, orgId: org.id, kind, termIds });
      }

      const splits = colourSplitsFrom(values.quantity);
      if (splits.length) await setColourSplits(draftId, splits);

      // The brand's own questions, as rows a vendor answers against.
      const questions = [0, 1, 2]
        .map((index) => values[`question-${index}`]?.trim())
        .filter(Boolean)
        .map((prompt, index) => ({ prompt, sort: index }));
      if (questions.length) await setQuestions(draftId, questions);

      const rows = unwrap(
        await supabase
          .from("factory_profiles")
          .select("org_id, location, moq, typical_lead_days, verification_status, intro, vendor_kind, orgs (id, name)")
          .not("published_at", "is", null),
        "load vendors",
      );
      // The design ranks this list by fit. match_score_rfq() answers per
      // pair, so score the vendors actually being shown and sort by it.
      const scores = await matchScoresForRfq(draftId, (rows ?? []).map((row) => row.org_id));
      setVendors(
        (rows ?? [])
          .map((row) => ({ ...row, matchPercent: scores.get(row.org_id) ?? null }))
          .sort((a, b) => (b.matchPercent ?? -1) - (a.matchPercent ?? -1)),
      );
      setStep("invite");
    } catch (failure) {
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

  if (step === "invite") {
    const shaped = vendors.map((vendor) => ({
      initials: (vendor.orgs?.name ?? "?").slice(0, 2).toUpperCase(),
      name: vendor.orgs?.name ?? "Vendor",
      location: vendor.location ?? "Location not given",
      trust: vendor.verification_status === "verified" ? "trusted" : "unverified",
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
      products: [],
      categories: [],
      capabilities: [],
      notes: vendor.intro ? [vendor.intro] : [],
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
          selectedFactories={selectedVendors}
          setSelectedFactories={setSelectedVendors}
          openToAll={openToAll}
          onOpenToAllChange={setOpenToAll}
        />
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
    >
      <ReviewScreen
        brief={freeText}
        values={values}
        onChange={change}
        onEditBrief={() => setStep("describe")}
        attachments={files}
        onAddFiles={addFiles}
        onRemoveFile={removeFile}
        uploading={uploading}
      />
      {error && <p className="composer-error" role="alert">{error.message}</p>}
    </FlowShell>
  );
}
