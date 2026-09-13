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
import { DescribeScreen, FlowShell, InviteScreen, ReviewScreen } from "../../prototype/main.jsx";
import { createDraftRfq, getRfq, publishRfq, saveRfq, setColourSplits, setInvitations, setQuestions } from "../../lib/domain/rfq.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { briefGenerationEnabled, generateBrief } from "../../lib/domain/brief.js";
import { listTermsByKind, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { toCents } from "../../lib/money.js";

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

const firstNumber = (text) => {
  const match = String(text ?? "").match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
};

export default function LiveComposer({ org, rfqId, onPublished }) {
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
          deadline: row.quote_deadline ?? "",
          category: "",
        });
      })
      .catch(setError);
  }, [rfqId]);

  const change = useCallback((name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

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

      if (useModel && briefGenerationEnabled && freeText.trim()) {
        const { fields } = await generateBrief({ freeText, terms });
        if (fields) {
          setValues((current) => ({
            ...current,
            title: fields.title ?? current.title ?? "",
            quantity: fields.quantity_total ? String(fields.quantity_total) : current.quantity ?? "",
            material: fields.material_notes ?? current.material ?? "",
            samples: fields.sample_notes ?? current.samples ?? "",
            timeline: fields.target_delivery_month ?? current.timeline ?? "",
          }));
        }
      }

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
      await saveRfq(draftId, {
        title: values.title?.trim() || values.category?.trim() || "Untitled request",
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
      setVendors(rows ?? []);
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
      onPublished?.(draftId);
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

  if (step === "invite") {
    const shaped = vendors.map((vendor) => ({
      initials: (vendor.orgs?.name ?? "?").slice(0, 2).toUpperCase(),
      name: vendor.orgs?.name ?? "Vendor",
      location: vendor.location ?? "Location not given",
      trust: vendor.verification_status === "verified" ? "trusted" : "unverified",
      // The design shows a fit percentage. There is a match_score RPC, but it
      // is per pair and this list is unranked until it is called — so no
      // number is shown rather than a made-up one.
      fit: "",
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
      />
      {error && <p className="composer-error" role="alert">{error.message}</p>}
    </FlowShell>
  );
}
