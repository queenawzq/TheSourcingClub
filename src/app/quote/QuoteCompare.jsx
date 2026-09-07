/**
 * Comparing quotes, and awarding one.
 *
 * TSC_DESIGN_SYSTEM.md is explicit about what belongs here: unit price, exact
 * quantity, bulk lead, sample plan, capacity window, factory notes, open
 * questions — and deliberately NOT MOQ or rating as a primary comparison
 * metric. A factory's MOQ is irrelevant once it has quoted a known quantity.
 *
 * Every figure is derived from stored columns. Production subtotal is price ×
 * quantity; sample subtotal comes from the SQL function over the sample lines.
 * The prototype hardcodes a sample subtotal per factory name while displaying
 * the lines that should produce it, and computes production totals by running
 * regexes over formatted strings.
 */
import React, { useEffect, useMemo, useState } from "react";
import { getQuestions, getRfq } from "../../lib/domain/rfq.js";
import { awardQuote, listQuotesForRfq, quoteTotalCents } from "../../lib/domain/quote.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { supabase } from "../../lib/supabase.js";
import "../rfq/rfq.css";
import "./quote.css";

const DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });

function fitTier(score) {
  if (score == null) return null;
  return score >= 0.9 ? "strong" : score >= 0.75 ? "good" : score >= 0.6 ? "potential" : "weak";
}

export default function QuoteCompare({ org, rfqId }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [termsById, setTermsById] = useState({});
  const [scores, setScores] = useState({});
  const [awarding, setAwarding] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    const [request, rows, qs, byKind] = await Promise.all([
      getRfq(rfqId),
      listQuotesForRfq(rfqId),
      getQuestions(rfqId),
      listTermsByKind(["payment_term", "incoterm"]),
    ]);

    setRfq(request);
    setQuotes(rows);
    setQuestions(qs);
    setTermsById(
      Object.fromEntries([...(byKind.payment_term ?? []), ...(byKind.incoterm ?? [])].map((t) => [t.id, t])),
    );

    const scored = await Promise.all(
      rows.map(async (quote) => {
        const { data } = await supabase.rpc("match_score_rfq", {
          rfq_id: rfqId,
          factory_org: quote.factory_org_id,
        });
        return [quote.id, data];
      }),
    );
    setScores(Object.fromEntries(scored));
  }

  useEffect(() => {
    load().catch(setError);
  }, [rfqId]);

  async function confirmAward(quote) {
    setAwarding(quote.id);
    setError(null);
    try {
      await awardQuote(quote.id);
      setConfirming(null);
      await load();
    } catch (awardError) {
      setError(awardError);
    } finally {
      setAwarding(null);
    }
  }

  const cheapest = useMemo(() => {
    if (!quotes?.length) return null;
    const totals = quotes.map((quote) => quoteTotalCents(quote)).filter((value) => value != null);
    return totals.length ? Math.min(...totals) : null;
  }, [quotes]);

  if (error && !quotes) {
    return (
      <div className="rfq-page">
        <h1>Quotes</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }

  if (!quotes || !rfq) {
    return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;
  }

  const awarded = quotes.find((quote) => quote.status === "accepted");

  return (
    <div className="rfq-page compare-page">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/rfqs/${rfqId}`)}>
        ← Back to the request
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>Quotes</h1>
          <p>
            {rfq.title} · {quotes.length} quote{quotes.length === 1 ? "" : "s"}
            {awarded ? " · awarded" : ""}
          </p>
        </div>
      </header>

      {error ? <p className="ob-error">{error.message}</p> : null}

      {quotes.length === 0 ? (
        <div className="rfq-empty">
          <p>No quotes yet.</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>
            Factories see this request in their browse list, sorted by how well it fits what they
            make.
          </p>
        </div>
      ) : (
        <div className="compare-scroll">
          <table className="compare-table" data-testid="quote-compare">
            <thead>
              <tr>
                <th>Factory</th>
                {quotes.map((quote) => (
                  <th key={quote.id} data-testid="compare-column">
                    <span className="compare-factory">{quote.orgs?.name ?? "Factory"}</span>
                    {scores[quote.id] != null ? (
                      <span className={`fit-chip fit-chip--${fitTier(scores[quote.id])}`}>
                        {Math.round(scores[quote.id] * 100)}% fit
                      </span>
                    ) : null}
                    {quote.status === "accepted" ? <span className="compare-won">Awarded</span> : null}
                    {quote.status === "declined" ? <span className="compare-lost">Not selected</span> : null}
                    {quote.version > 1 ? (
                      <span className="compare-version">Revised · v{quote.version}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Unit price</th>
                {quotes.map((quote) => (
                  <td key={quote.id} className="num" data-testid="cell-unit-price">
                    {formatMoney(quote.unit_price_cents)}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Quantity</th>
                {quotes.map((quote) => (
                  <td key={quote.id} className="num">{quote.production_quantity?.toLocaleString() ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <th>Bulk lead time</th>
                {quotes.map((quote) => (
                  <td key={quote.id} className="num">
                    {quote.bulk_lead_time_days != null ? `${quote.bulk_lead_time_days} days` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Production subtotal</th>
                {quotes.map((quote) => (
                  <td key={quote.id} className="num">{formatMoney(quote.productionSubtotalCents)}</td>
                ))}
              </tr>
              <tr>
                <th>Sample plan</th>
                {quotes.map((quote) => (
                  <td key={quote.id}>
                    {quote.sampleLines.length ? (
                      <ul className="compare-samples">
                        {quote.sampleLines.map((line, index) => (
                          <li key={index}>
                            {line.stage} · {formatMoney(line.cost_cents)}
                            {line.timing_days ? ` · ${line.timing_days}d` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : "No samples quoted"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Sample subtotal</th>
                {quotes.map((quote) => (
                  <td key={quote.id} className="num" data-testid="cell-sample-subtotal">
                    {formatMoney(quote.sampleSubtotalCents)}
                  </td>
                ))}
              </tr>
              <tr className="compare-total-row">
                <th>Quote total</th>
                {quotes.map((quote) => {
                  const total = quoteTotalCents(quote);
                  return (
                    <td key={quote.id} className="num" data-testid="cell-quote-total">
                      <strong>{formatMoney(total)}</strong>
                      {total != null && total === cheapest && quotes.length > 1 ? (
                        <span className="compare-cheapest">lowest</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th>Payment terms</th>
                {quotes.map((quote) => (
                  <td key={quote.id}>
                    {quote.payment_term_id ? termLabel(termsById[quote.payment_term_id]) : "—"}
                    {quote.deposit_pct != null ? (
                      <span className="compare-sub">{quote.deposit_pct}% / {quote.balance_pct}%</span>
                    ) : null}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Shipping</th>
                {quotes.map((quote) => (
                  <td key={quote.id}>
                    {quote.incoterm_id ? termLabel(termsById[quote.incoterm_id]) : "—"}
                    {quote.shipping_notes ? <span className="compare-sub">{quote.shipping_notes}</span> : null}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Capacity window</th>
                {quotes.map((quote) => (
                  <td key={quote.id}>
                    {quote.capacity_window_start
                      ? `${DATE.format(new Date(quote.capacity_window_start))}–${
                          quote.capacity_window_end ? DATE.format(new Date(quote.capacity_window_end)) : "?"
                        }`
                      : "—"}
                    {quote.capacity_window_units ? (
                      <span className="compare-sub">{quote.capacity_window_units.toLocaleString()} units held</span>
                    ) : null}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Valid until</th>
                {quotes.map((quote) => (
                  <td key={quote.id} className="num">
                    {quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : "—"}
                  </td>
                ))}
              </tr>

              {questions.map((question) => (
                <tr key={question.id}>
                  <th>
                    {question.prompt}
                    {question.is_sensitive ? <span className="private-tag">Private</span> : null}
                  </th>
                  {quotes.map((quote) => (
                    <td key={quote.id}>
                      {quote.answers.find((a) => a.question_id === question.id)?.answer_text ?? (
                        <span className="compare-sub">No answer</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}

              <tr>
                <th>Notes from factory</th>
                {quotes.map((quote) => (
                  <td key={quote.id}>{quote.factory_notes || <span className="compare-sub">None</span>}</td>
                ))}
              </tr>

              {!awarded ? (
                <tr>
                  <th />
                  {quotes.map((quote) => (
                    <td key={quote.id}>
                      <button
                        type="button"
                        className="primary-btn compare-award"
                        disabled={awarding !== null}
                        onClick={() => setConfirming(quote)}
                      >
                        Award this quote
                      </button>
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {confirming ? (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-label="Confirm award">
          <div className="confirm-card">
            <h2>Award to {confirming.orgs?.name}?</h2>
            <p>
              {formatMoney(quoteTotalCents(confirming))} total ·{" "}
              {confirming.bulk_lead_time_days} day lead time.
            </p>
            <p className="ob-hint">
              This closes the request. The other{" "}
              {quotes.filter((q) => q.id !== confirming.id).length === 1 ? "factory is" : "factories are"}{" "}
              told they were not selected, so nobody is left waiting on an answer.
            </p>
            <div className="confirm-actions">
              <button type="button" className="quiet-btn" onClick={() => setConfirming(null)} disabled={awarding !== null}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => confirmAward(confirming)}
                disabled={awarding !== null}
              >
                {awarding ? "Awarding…" : "Yes, award it"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
