import React from "react";
import { FACTOR_LABELS, matchLabel } from "../../lib/domain/matching.js";
import { matchFit } from "../rfq/match-fit.js";
import "./matching.css";
export default function FactoryMatch({ match, name = "Factory" }) {
  if (!match)
    return (
      <p className="matching-summary">
        Needs confirmation — assessment unavailable
      </p>
    );
  const band = matchFit(match.score);
  return (
    <details
      className={`matching-summary ${match.status}`}
      data-testid="factory-match"
    >
      <summary>
        {matchLabel(match)} ·{" "}
        {match.status === "excluded"
          ? "Requirements not met"
          : `${Math.round(match.score)}%${match.status === "needs_confirmation" ? " provisional" : ` · ${band?.label ?? ""}`}`}
      </summary>
      <div aria-label={`${name} match breakdown`}>
        <p>
          Evidence coverage: {Math.round(match.coverage)}%. Missing factory
          information earns no points. Unspecified brand preferences are
          omitted.
        </p>
        <ul>
          {match.factors.map((f) => (
            <li key={f.key}>
              {FACTOR_LABELS[f.key]}: {f.points.toFixed(1)} /{" "}
              {f.weight.toFixed(1)} points
            </li>
          ))}
        </ul>
        {match.failed.length > 0 && (
          <>
            <strong>Requirements not met</strong>
            <ul>
              {match.failed.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        )}
        {match.missing.length > 0 && (
          <>
            <strong>Needs confirmation</strong>
            <ul>
              {match.missing.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        )}
        <p>
          {match.evidence.some((e) => e.status === "self_reported")
            ? "Includes factory self-reported capabilities. "
            : ""}
          {match.evidence.some((e) => e.status === "reviewed")
            ? "Includes staff-reviewed capability evidence. "
            : ""}
          {match.timeline_estimated
            ? "Timeline is an estimate based on factory information, not a delivery guarantee."
            : ""}
        </p>
        {match.vendor_kind === "trading_company" && (
          <p>
            Trading company: capabilities describe its sourcing network, not
            verified ownership of a manufacturing facility.
          </p>
        )}
      </div>
    </details>
  );
}
