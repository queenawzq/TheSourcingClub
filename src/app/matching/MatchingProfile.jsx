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
      .then(
        ([terms, selected, details]) =>
          live &&
          setState({
            terms,
            selected: Object.values(selected).flat(),
            details: {
              required_term_ids: [],
              preferred_countries: [],
              accepted_countries: [],
              colour_quantities: [],
              ...details,
            },
          }),
      )
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [enabled, org.id, subjectType, subjectId, factory]);
  if (!enabled) return null;
  const change = (patch) => {
    setState((s) => ({ ...s, details: { ...s.details, ...patch } }));
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
    <label key={key}>
      {label}
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
  return (
    <section
      className="matching-panel"
      aria-label={factory ? "Factory matching profile" : "Matching preferences"}
    >
      <h2>
        {factory
          ? "Complete your matching profile"
          : "Matching preferences and requirements"}
      </h2>
      <p>
        {factory
          ? "Missing information is shown to brands as Needs confirmation. Company verification and quoting access are unchanged. Capabilities are self-reported unless TSC reviews supporting evidence."
          : "Product categories are required. Mark any other must-haves below; unmarked selections are preferences. Each request represents one style."}
      </p>
      {state && (
        <>
          {factory &&
            ["moq_per_colour", "usual_order_min", "usual_order_max"].some(
              (k) => state.details[k] == null,
            ) && (
              <p role="status">
                Complete your per-colour minimum and usual order-size range to
                improve match readiness.
              </p>
            )}
          {MATCH_KINDS.filter((k) => !factory || k !== "certification").map(
            (kind) => (
              <details key={kind}>
                <summary>
                  {TITLES[kind]} ·{" "}
                  {(state.terms[kind] ?? [])
                    .filter((t) => state.selected.includes(t.id))
                    .map((t) => termLabel(t))
                    .join(", ") || "Not specified"}
                </summary>
                <fieldset>
                  <legend>{TITLES[kind]}</legend>
                  {(state.terms[kind] ?? []).map((t) => (
                    <div className="matching-choice" key={t.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={state.selected.includes(t.id)}
                          onChange={() => toggle(t.id)}
                        />
                        {termLabel(t)}
                      </label>
                      {!factory &&
                        ["fabric", "technique", "certification"].includes(
                          kind,
                        ) &&
                        state.selected.includes(t.id) && (
                          <label>
                            <input
                              type="checkbox"
                              checked={state.details.required_term_ids.includes(
                                t.id,
                              )}
                              onChange={(e) =>
                                change({
                                  required_term_ids: e.target.checked
                                    ? [...state.details.required_term_ids, t.id]
                                    : state.details.required_term_ids.filter(
                                        (x) => x !== t.id,
                                      ),
                                })
                              }
                            />
                            Required
                          </label>
                        )}
                    </div>
                  ))}
                </fieldset>
              </details>
            ),
          )}
          {factory ? (
            <div className="matching-fields">
              {field("moq_per_colour", "MOQ per colour (units)")}
              {field("usual_order_min", "Usual order minimum (units/style)")}
              {field("usual_order_max", "Usual order maximum (units/style)")}
            </div>
          ) : (
            <>
              {subjectType === "brand_profile" && (
                <div className="matching-fields">
                  {field("quantity", "Expected units per style")}
                  <label>
                    Units per colour (comma separated)
                    <input
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
              )}
              {["preferred_countries", "accepted_countries"].map((k) => (
                <label key={k}>
                  {k === "preferred_countries"
                    ? "Preferred manufacturing countries"
                    : "Also accepted countries"}
                  <select
                    multiple
                    value={state.details[k]}
                    onChange={(e) =>
                      change({
                        [k]: [...e.target.selectedOptions].map((x) => x.value),
                      })
                    }
                  >
                    {(state.terms.country ?? [])
                      .filter((t) => t.extra?.code)
                      .map((t) => (
                        <option key={t.id} value={t.extra.code}>
                          {termLabel(t)}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              <label className="matching-choice">
                <input
                  type="checkbox"
                  checked={!!state.details.location_required}
                  onChange={(e) =>
                    change({ location_required: e.target.checked })
                  }
                />
                Only these manufacturing countries are allowed
              </label>
              <div className="matching-fields">
                {field("sample_deadline", "Sample deadline", "date")}
                {field("bulk_deadline", "Bulk deadline", "date")}
                <label>
                  Bulk deadline means
                  <select
                    value={state.details.bulk_deadline_type ?? ""}
                    onChange={(e) =>
                      change({ bulk_deadline_type: e.target.value })
                    }
                  >
                    <option value="">
                      Choose when a bulk deadline is given
                    </option>
                    <option value="ready_to_ship">Ready to ship</option>
                    <option value="delivered">Delivered</option>
                  </select>
                </label>
                {field(
                  "shipping_days",
                  "Shipping allowance (days, for delivered deadlines)",
                )}
              </div>
              {subjectType === "brand_profile" && (
                <label className="matching-choice">
                  <input
                    type="checkbox"
                    checked={!!state.details.requires_sample}
                    onChange={(e) =>
                      change({ requires_sample: e.target.checked })
                    }
                  />
                  Sampling needed before bulk
                </label>
              )}
              <p>
                Dates are assessed against factory lead times and estimated
                availability. A delivered deadline needs a shipping allowance.
              </p>
            </>
          )}
          <button type="button" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save matching information"}
          </button>
          {saved && <p role="status">Matching information saved.</p>}
        </>
      )}
      {!state && !error && <p>Loading matching information…</p>}
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}
