import { getSelectedTerms } from "../../lib/domain/profile.js";
import React, { useEffect, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import {
  MATCH_KINDS,
  matchingEnabled,
  saveMatchingProfile,
} from "../../lib/domain/matching.js";
import "./matching.css";
export function useMatchingStatus() {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    let live = true;
    matchingEnabled().then((x) => live && setEnabled(x));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
export function useMatchingEnabled() {
  return useMatchingStatus() === true;
}

const TITLES = {
  product_category: "Product categories",
  fabric: "Fabrics",
  technique: "Techniques",
  development_service: "Development support",
  certification: "Certifications",
};
const nilNumber = (x) => (x === "" || x == null ? null : Number(x));
export default function MatchingProfile({
  org,
  subjectType,
  subjectId = org.id,
  onDirty = () => {},
  onSaved = () => {},
}) {
  const enabled = useMatchingEnabled();
  const [state, setState] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const factory = subjectType === "factory_profile";
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.all([
      listTermsByKind([...MATCH_KINDS, "country"]),
      getSelectedTerms(subjectType, subjectId),
      supabase
        .from(factory ? "factory_matching_facts" : "matching_requirements")
        .select("*")
        .match(
          factory
            ? { org_id: org.id }
            : { subject_type: subjectType, subject_id: subjectId },
        )
        .maybeSingle()
        .then((x) => unwrap(x, "load matching details")),
    ])
      .then(async ([terms, selected, details]) => {
        let picked = Object.values(selected).flat();
        let start = details;
        let fromProfile = false;
        // A request with nothing saved yet starts from the brand's own
        // preferences: its fabrics, techniques, services, certificates and
        // countries. Product categories, quantities and dates are the
        // request's own.
        if (subjectType === "rfq" && !details) {
          const [profileTerms, profile] = await Promise.all([
            getSelectedTerms("brand_profile", org.id),
            supabase
              .from("matching_requirements")
              .select("required_term_ids,preferred_countries,accepted_countries,location_required")
              .match({ subject_type: "brand_profile", subject_id: org.id })
              .maybeSingle()
              .then((x) => unwrap(x, "load brand matching preferences")),
          ]);
          const carried = ["fabric", "technique", "development_service", "certification"]
            .flatMap((k) => profileTerms[k] ?? [])
            .filter((id) => !picked.includes(id));
          if (carried.length || profile) {
            picked = [...picked, ...carried];
            start = profile && {
              ...profile,
              required_term_ids: (profile.required_term_ids ?? []).filter((id) => picked.includes(id)),
            };
            fromProfile = true;
          }
        }
        if (!live) return;
        setState({
          terms,
          selected: picked,
          fromProfile,
          details: {
            required_term_ids: [],
            preferred_countries: [],
            accepted_countries: [],
            colour_quantities: [],
            ...start,
          },
        });
        // Not saved yet, so the composer asks for a save before inviting.
        if (fromProfile) onDirty();
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [enabled, org.id, subjectType, subjectId, factory]);
  if (!enabled) return null;
  // A patch, or a function of the current details: two quick clicks must
  // not both start from the same render.
  const change = (patch) => {
    setState((s) => ({
      ...s,
      details: { ...s.details, ...(typeof patch === "function" ? patch(s.details) : patch) },
    }));
    setSaved(false);
    onDirty();
  };
  const toggle = (id) => {
    setState((s) => ({
      ...s,
      selected: s.selected.includes(id)
        ? s.selected.filter((x) => x !== id)
        : [...s.selected, id],
      details: {
        ...s.details,
        required_term_ids: (s.details.required_term_ids ?? []).filter(
          (x) => x !== id,
        ),
      },
    }));
    setSaved(false);
    onDirty();
  };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const d = { ...state.details };
      for (const k of [
        "moq_per_colour",
        "usual_order_min",
        "usual_order_max",
        "quantity",
        "shipping_days",
      ])
        d[k] = nilNumber(d[k]);
      for (const k of [
        "sample_deadline",
        "bulk_deadline",
        "bulk_deadline_type",
      ])
        d[k] = d[k] || null;
      if (subjectType === "rfq") {
        const r = unwrap(
          await supabase
            .from("rfqs")
            .select("quantity_total,requires_sample")
            .eq("id", subjectId)
            .single(),
          "load current request",
        );
        const c = unwrap(
          await supabase
            .from("rfq_colour_splits")
            .select("quantity")
            .eq("rfq_id", subjectId),
          "load colours",
        );
        d.quantity = r.quantity_total;
        d.colour_quantities = c.map((x) => x.quantity);
        d.requires_sample = r.requires_sample;
      }
      await saveMatchingProfile(
        subjectType,
        subjectId,
        state.selected.filter((id) =>
          Object.values(state.terms)
            .flat()
            .some((t) => t.id === id && MATCH_KINDS.includes(t.kind)),
        ),
        d,
      );
      setSaved(true);
      onSaved({ selected: state.selected, terms: state.terms });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const field = (key, label, type = "number") => (
    <label className="matching-field" key={key}>
      <span className="matching-label">{label}</span>
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={state.details[key] ?? ""}
        onInput={
          type === "date"
            ? (e) => change({ [key]: e.currentTarget.value })
            : undefined
        }
        onChange={
          type === "date" ? undefined : (e) => change({ [key]: e.target.value })
        }
      />
    </label>
  );
  // Chips, the onboarding chip group's selectable buttons.
  const chips = (items, isOn, onToggle, labelFor, required = false) => (
    <div className={`matching-chips${required ? " is-required" : ""}`}>
      {items.map((item) => (
        <button
          type="button"
          key={item.key}
          aria-pressed={isOn(item)}
          onClick={() => onToggle(item)}
        >
          {labelFor(item)}
        </button>
      ))}
    </div>
  );
  const required = state?.details.required_term_ids ?? [];
  const toggleRequired = (id) =>
    change((d) => {
      const current = d.required_term_ids ?? [];
      return {
        required_term_ids: current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id],
      };
    });
  // A country is preferred or accepted, never both.
  const toggleCountry = (list, code) => {
    const other = list === "preferred_countries" ? "accepted_countries" : "preferred_countries";
    change((d) => {
      const current = d[list] ?? [];
      return {
        [list]: current.includes(code) ? current.filter((x) => x !== code) : [...current, code],
        [other]: (d[other] ?? []).filter((x) => x !== code),
      };
    });
  };
  const countries = (state?.terms.country ?? [])
    .filter((t) => t.extra?.code)
    .map((t) => ({ key: t.extra.code, term: t }));
  const asItems = (terms) => terms.map((t) => ({ key: t.id, term: t }));
  const factsMissing =
    factory &&
    state &&
    ["moq_per_colour", "usual_order_min", "usual_order_max"].some(
      (k) => state.details[k] == null || state.details[k] === "",
    );
  return (
    <section
      className="matching-panel"
      aria-label={factory ? "Factory matching profile" : "Matching preferences"}
    >
      <header className="matching-head">
        <h2>
          {factory
            ? "Matching profile"
            : subjectType === "rfq"
              ? "Matching requirements for this request"
              : "Matching preferences"}
        </h2>
        <p>
          {factory
            ? "What you make and the order sizes you usually take. Brands see anything missing as “Needs confirmation”; it never affects your company verification or your quoting."
            : "Choose what you need. Mark any must-haves: factories without them are left out of your matches. Everything else is a preference that improves the ranking."}
        </p>
      </header>
      {state && (
        <>
          {state.fromProfile && !saved && (
            <p className="matching-callout" role="status">
              Filled in from your brand profile’s preferences. Change anything
              for this request, then save.
            </p>
          )}
          {factsMissing && (
            <p className="matching-callout is-warning" role="status">
              Add your MOQ per colour and usual order sizes so brands can see
              you as a full match.
            </p>
          )}
          <div className="matching-section">
            <h3>{factory ? "What you make" : "What you need"}</h3>
            {MATCH_KINDS.filter((k) => !factory || k !== "certification").map(
              (kind) => {
                const options = state.terms[kind] ?? [];
                const picked = options.filter((t) => state.selected.includes(t.id));
                const canRequire =
                  !factory && ["fabric", "technique", "certification"].includes(kind);
                return (
                  <details className="matching-group" key={kind}>
                    <summary>
                      <span className="matching-label">{TITLES[kind]}</span>
                      <span className="matching-small">
                        {picked
                          .map((t) => `${termLabel(t)}${required.includes(t.id) ? " (must-have)" : ""}`)
                          .join(", ") || "Not specified"}
                      </span>
                    </summary>
                    <div className="matching-group-body">
                      {chips(
                        asItems(options),
                        (item) => state.selected.includes(item.key),
                        (item) => toggle(item.key),
                        (item) => termLabel(item.term),
                      )}
                      {canRequire && picked.length > 0 && (
                        <>
                          <span className="matching-label">Must-haves</span>
                          {chips(
                            asItems(picked),
                            (item) => required.includes(item.key),
                            (item) => toggleRequired(item.key),
                            (item) => termLabel(item.term),
                            true,
                          )}
                        </>
                      )}
                    </div>
                  </details>
                );
              },
            )}
          </div>
          {factory ? (
            <div className="matching-section">
              <h3>Order sizes</h3>
              <div className="matching-fields">
                {field("moq_per_colour", "MOQ per colour (units)")}
                {field("usual_order_min", "Usual order minimum (units per style)")}
                {field("usual_order_max", "Usual order maximum (units per style)")}
              </div>
            </div>
          ) : (
            <>
              {subjectType === "brand_profile" && (
                <div className="matching-section">
                  <h3>Typical order</h3>
                  <div className="matching-fields">
                    {field("quantity", "Units per style")}
                    <label className="matching-field">
                      <span className="matching-label">Units per colour</span>
                      <input
                        placeholder="e.g. 150, 150"
                        value={(state.details.colour_quantities ?? []).join(", ")}
                        onChange={(e) =>
                          change({
                            colour_quantities: e.target.value
                              .split(",")
                              .map((x) => Number(x.trim()))
                              .filter((x) => x > 0),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
              <div className="matching-section">
                <h3>Where it is made</h3>
                {[
                  ["preferred_countries", "Preferred countries"],
                  ["accepted_countries", "Also acceptable"],
                ].map(([list, title]) => (
                  <details className="matching-group" key={list}>
                    <summary>
                      <span className="matching-label">{title}</span>
                      <span className="matching-small">
                        {countries
                          .filter((item) => (state.details[list] ?? []).includes(item.key))
                          .map((item) => termLabel(item.term))
                          .join(", ") || "Any"}
                      </span>
                    </summary>
                    <div className="matching-group-body">
                      {chips(
                        countries,
                        (item) => (state.details[list] ?? []).includes(item.key),
                        (item) => toggleCountry(list, item.key),
                        (item) => termLabel(item.term),
                      )}
                    </div>
                  </details>
                ))}
                <label className="matching-check">
                  <input
                    type="checkbox"
                    checked={!!state.details.location_required}
                    onChange={(e) => change({ location_required: e.target.checked })}
                  />
                  Only these countries are allowed
                </label>
              </div>
              <div className="matching-section">
                <h3>Timing</h3>
                <div className="matching-fields">
                  {field("sample_deadline", "Sample deadline", "date")}
                  {field("bulk_deadline", "Bulk deadline", "date")}
                  <label className="matching-field">
                    <span className="matching-label">Bulk deadline means</span>
                    <select
                      value={state.details.bulk_deadline_type ?? ""}
                      onChange={(e) => change({ bulk_deadline_type: e.target.value })}
                    >
                      <option value="">Choose one</option>
                      <option value="ready_to_ship">Ready to ship</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </label>
                  {field("shipping_days", "Shipping allowance (days)")}
                </div>
                {subjectType === "brand_profile" && (
                  <label className="matching-check">
                    <input
                      type="checkbox"
                      checked={!!state.details.requires_sample}
                      onChange={(e) => change({ requires_sample: e.target.checked })}
                    />
                    Sampling needed before bulk
                  </label>
                )}
                <p className="matching-hint">
                  Dates are checked against each factory’s lead times and open
                  capacity. A delivered deadline needs a shipping allowance.
                </p>
              </div>
            </>
          )}
          <div className="matching-actions">
            {saved && !error && <p className="matching-saved" role="status">Saved.</p>}
            {error && <p role="alert">{error.message}</p>}
            <button type="button" className="matching-btn is-primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : factory ? "Save matching profile" : "Save matching preferences"}
            </button>
          </div>
        </>
      )}
      {!state && !error && <p className="matching-hint">Loading matching information…</p>}
      {!state && error && <p role="alert">{error.message}</p>}
    </section>
  );
}
