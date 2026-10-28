import React from "react";
import { FACTOR_LABELS } from "../../lib/domain/matching.js";
import { matchFit } from "../rfq/match-fit.js";
import "./matching.css";

// The pill: a qualified match takes the shared fit tier for its score; one
// that needs confirmation is the potential (amber) tier and says
// "provisional"; one that fails a must-have is the tradeoff tier. The card
// around it already shows the percentage as its "match" metric.
function pillFor(match) {
  if (match.status === "excluded") return { tone: "is-bad", label: "Not eligible" };
  if (match.status === "needs_confirmation") return { tone: "is-warn", label: "Needs confirmation" };
  const band = matchFit(match.score);
  const tone = band?.tone === "strong" ? "is-strong" : band?.tone === "good" ? "is-good" : "is-warn";
  return { tone, label: band?.label ?? "Qualified" };
}

// The engine's reasons are stored with the migration that writes them; the
// two that use internal words are worded for the brand here.
const PLAIN = {
  "Confirm precise deadlines; legacy delivery month is an estimate":
    "Confirm exact dates: the request only gives a delivery month",
  "Review mandatory requirements after editing the request":
    "Check the must-haves: the request changed after they were set",
};
const plain = (reason) => PLAIN[reason] ?? reason;

export default function FactoryMatch({ match, name = "Factory", open = false }) {
  if (!match) return null;
  const pill = pillFor(match);
  const score = Math.round(match.score);
  const notes = [
    match.evidence.some((e) => e.status === "self_reported") && "Includes capabilities the factory reported itself.",
    match.evidence.some((e) => e.status === "reviewed") && "Includes capability evidence reviewed by TSC.",
    match.timeline_estimated && "Timing is estimated from the factory's information, not promised.",
    match.vendor_kind === "trading_company" && "A trading company: capabilities describe its partner network, not a facility it owns.",
  ].filter(Boolean);

  return (
    // The designed cards select or open on click; the disclosure is its own control.
    <details className="matching-why" data-testid="factory-match" open={open || undefined} onClick={(event) => event.stopPropagation()}>
      <summary>
        <span className={`matching-pill ${pill.tone}`}>{pill.label}</span>
        <span className="matching-why-toggle">Why this match</span>
      </summary>
      <div className="matching-why-body" aria-label={`${name} match breakdown`}>
        {match.failed.length > 0 && (
          <section className="is-bad">
            <h4>Not eligible because</h4>
            <ul>{match.failed.map((x) => <li key={x}>{plain(x)}</li>)}</ul>
          </section>
        )}
        {match.missing.length > 0 && (
          <section>
            <h4>To confirm with the factory</h4>
            <ul>{match.missing.map((x) => <li key={x}>{plain(x)}</li>)}</ul>
          </section>
        )}
        {match.status !== "excluded" && (
          <section>
            <h4>
              {score}% {match.status === "needs_confirmation" ? "provisional match" : "match"}
              {" "}· information covers {Math.round(match.coverage)}%
            </h4>
            <dl className="matching-points">
              {match.factors.map((f) => (
                <div key={f.key}>
                  <dt>{FACTOR_LABELS[f.key]}</dt>
                  <dd>{f.points.toFixed(1)} / {f.weight.toFixed(1)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        <p className="matching-small">
          Missing factory information earns no points; preferences the brand left open are not scored.
          {notes.length > 0 && " "}{notes.join(" ")}
        </p>
      </div>
    </details>
  );
}
