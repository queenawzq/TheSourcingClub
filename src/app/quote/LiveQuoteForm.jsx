/**
 * Submitting a quote, on Queena's designed screen.
 *
 * `FactorySubmitQuote` comes from src/factory-prototype/main.jsx. This file is
 * the seam.
 *
 * The design writes its quote as prose — "30% deposit / 70% before shipment",
 * "EXW quoted; shipping TBD" — where the schema keeps taxonomy ids, because a
 * brand compares quotes on those terms and cannot compare sentences. So the
 * typed value is MATCHED against the vocabulary rather than parsed into it:
 * a payment split by its numbers, an incoterm by its three-letter code.
 *
 * Nothing is guessed. A value that matches no term stores nothing, and
 * `submit_quote()` then refuses and names the field it is missing — which the
 * screen shows. That is the honest failure: better a factory is told which
 * term it needs than a quote is stored against one nobody chose.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FactorySubmitQuote } from "../../factory-prototype/main.jsx";
import {
  createDraftQuote,
  getMyQuote,
  getSampleLines,
  saveQuote,
  setSampleLines,
  submitQuote,
} from "../../lib/domain/quote.js";
import { getRfq } from "../../lib/domain/rfq.js";
import { listTermsByKind } from "../../lib/domain/taxonomy.js";
import { toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const KINDS = ["payment_term", "incoterm"];

const firstNumber = (text) => {
  const match = String(text ?? "").match(/\d[\d,]*(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
};

/** "30% deposit / 70% before shipment" → the deposit-30-70 term. */
function paymentTermFrom(terms, typed) {
  const text = String(typed ?? "").toLowerCase();
  const deposit = text.match(/(\d{2})\s*%/);
  if (deposit) {
    const slug = `deposit-${deposit[1]}-${100 - Number(deposit[1])}`;
    const hit = terms.find((term) => term.slug === slug);
    if (hit) return hit;
  }
  if (/paid in full/.test(text)) return terms.find((term) => term.slug === "paid-in-full");
  if (/net\s*30/.test(text)) return terms.find((term) => term.slug === "net-30");
  return null;
}

/** "EXW quoted; shipping TBD" → the EXW term. */
function incotermFrom(terms, typed) {
  const text = String(typed ?? "").toUpperCase();
  return terms.find((term) => new RegExp(`\\b${term.slug.toUpperCase()}\\b`).test(text)) ?? null;
}

/** The deposit percentage the payment term implies, for the schedule generator. */
function depositPctFrom(slug) {
  const match = String(slug ?? "").match(/^deposit-(\d+)-(\d+)$/);
  if (match) return Number(match[1]);
  if (slug === "paid-in-full") return 100;
  if (slug === "net-30") return 0;
  return null;
}

export default function LiveQuoteForm({ org, rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [quote, setQuote] = useState(null);
  const [lines, setLines] = useState([]);
  const [terms, setTerms] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const kinds = useMemo(() => KINDS, []);

  const load = useCallback(async () => {
    try {
      const [request, vocab] = await Promise.all([getRfq(rfqId), listTermsByKind(kinds)]);
      setRfq(request);
      setTerms(vocab);

      const mine = (await getMyQuote(rfqId, org.id)) ?? (await createDraftQuote(rfqId, org.id));
      setQuote(mine);
      setLines((await getSampleLines(mine.id)) ?? []);
    } catch (failure) {
      setError(failure);
    }
  }, [rfqId, org.id, kinds]);

  useEffect(() => { load(); }, [load]);

  async function send(values) {
    if (busy || !quote) return;
    setBusy(true);
    setError(null);

    try {
      const unit = firstNumber(values.unitPrice);
      const payment = paymentTermFrom(terms.payment_term ?? [], values.paymentTerms);
      const incoterm = incotermFrom(terms.incoterm ?? [], values.incoterms);
      const depositPct = depositPctFrom(payment?.slug);

      await saveQuote(quote.id, {
        unit_price_cents: unit == null ? null : toCents(unit),
        production_quantity: firstNumber(values.quantity),
        bulk_lead_time_days: firstNumber(values.leadTime),
        payment_term_id: payment?.id ?? null,
        incoterm_id: incoterm?.id ?? null,
        // deposit_pct is nullable and submit_quote does not require it, but an
        // order generated from a quote without one gets milestones totalling
        // only the sample lines, agree_schedule refuses that forever, and the
        // order is dead with nothing on screen explaining why.
        deposit_pct: depositPct,
        balance_pct: depositPct == null ? null : 100 - depositPct,
        valid_until: (() => {
          const parsed = Date.parse(values.validUntil ?? "");
          return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
        })(),
      });

      // Each designed sample stage becomes a row; the quote total is computed
      // from them rather than typed.
      const stages = [0, 1]
        .map((index) => ({
          stage: values[`sample.${index}.stage`]?.trim(),
          cost_cents: (() => {
            const amount = firstNumber(values[`sample.${index}.cost`]);
            return amount == null ? null : toCents(amount);
          })(),
          timing_days: firstNumber(values[`sample.${index}.timing`]),
          includes: values[`sample.${index}.includes`]?.trim() || null,
          sort: index,
        }))
        .filter((row) => row.stage && row.cost_cents != null);
      if (stages.length) await setSampleLines(quote.id, stages);

      await submitQuote(quote.id);
      navigate(`/browse/${rfqId}/quote/sent`);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!rfq || !quote) return null;

  const money = (cents) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);
  const line = (index) => lines[index];

  return (
    <FactorySubmitQuote
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      language="en"
      project={{
        title: rfq.title || "Request",
        brand: rfq.orgs?.name ?? "",
        quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
        specialty: rfq.brief ?? "",
        images: [],
        tags: [],
        // The card lists the fit reasons it was matched on. There is no
        // per-pair score behind this list, so it is empty rather than invented
        // — and empty, not absent, because the card reads it.
        capacity: [],
        initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
        budget: "",
        samples: rfq.requires_sample ? "Sample required" : "No sample",
        quoteDue: "",
        fitTone: "",
      }}
      values={{
        unitPrice: quote.unit_price_cents ? `${money(quote.unit_price_cents)} / unit` : undefined,
        quantity: quote.production_quantity
          ? `${quote.production_quantity} units`
          : rfq.quantity_total
            ? `${rfq.quantity_total} units`
            : undefined,
        leadTime: quote.bulk_lead_time_days ? `${quote.bulk_lead_time_days} days` : undefined,
        validUntil: quote.valid_until ?? undefined,
        "sample.0.stage": line(0)?.stage,
        "sample.0.cost": line(0) ? money(line(0).cost_cents) : undefined,
        "sample.0.timing": line(0)?.timing_days ? `${line(0).timing_days} days` : undefined,
        "sample.0.includes": line(0)?.includes,
        "sample.1.stage": line(1)?.stage,
        "sample.1.cost": line(1) ? money(line(1).cost_cents) : undefined,
        "sample.1.timing": line(1)?.timing_days ? `${line(1).timing_days} days` : undefined,
        "sample.1.includes": line(1)?.includes,
      }}
      onBack={() => navigate(`/browse/${rfqId}`)}
      onSubmit={send}
      busy={busy}
      error={error}
    />
  );
}
