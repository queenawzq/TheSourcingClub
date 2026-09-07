/**
 * Reading and writing factory capacity.
 *
 * Kept apart from capacity.js, which is pure arithmetic mirroring the SQL and
 * has no idea a database exists. Splitting them means the conversion can be
 * tested without a connection, and stays easy to compare against migration 003.
 */
import { supabase, unwrap } from "../supabase.js";
import { capacityWindow, monthKey } from "./capacity.js";

/** Current capacity and the booking level for each of the next six months. */
export async function getCapacity(orgId) {
  const capacity = unwrap(
    await supabase
      .from("factory_capacity")
      .select("org_id, category_term_id, input_mode, line_hours, monthly_units")
      .eq("org_id", orgId)
      .maybeSingle(),
    "load your capacity",
  );

  const rows = unwrap(
    await supabase
      .from("factory_capacity_months")
      .select("month, level")
      .eq("org_id", orgId),
    "load your booking calendar",
  );

  const months = rows.reduce((grouped, row) => {
    grouped[row.month] = row.level;
    return grouped;
  }, {});

  return { capacity, months };
}

/**
 * Save capacity and the booking calendar.
 *
 * Months outside the rolling six-month window are deleted rather than left to
 * rot: a stale "mostly open" on a month that has already passed is worse than
 * no answer, because a brand reads it as a current claim.
 */
export async function saveCapacity(orgId, capacity, months) {
  const mode = capacity.input_mode ?? "units";

  // The table requires the figure matching the selected mode, so send only that
  // one and null the other rather than letting a stale value linger.
  const row = {
    org_id: orgId,
    category_term_id: capacity.category_term_id || null,
    input_mode: mode,
    line_hours: mode === "hours" ? Number(capacity.line_hours) || null : null,
    monthly_units: mode === "units" ? Number(capacity.monthly_units) || null : null,
  };

  if (mode === "hours" ? !row.line_hours : !row.monthly_units) {
    // Nothing entered yet. Saving would violate the check constraint, and a
    // half-filled capacity row is worse than none.
    return null;
  }

  unwrap(
    await supabase.from("factory_capacity").upsert(row, { onConflict: "org_id" }),
    "save your capacity",
  );

  const window = capacityWindow(6).map(monthKey);
  const entries = Object.entries(months).filter(([month]) => window.includes(month));

  if (entries.length) {
    unwrap(
      await supabase.from("factory_capacity_months").upsert(
        entries.map(([month, level]) => ({ org_id: orgId, month, level })),
        { onConflict: "org_id,month" },
      ),
      "save your booking calendar",
    );
  }

  unwrap(
    await supabase
      .from("factory_capacity_months")
      .delete()
      .eq("org_id", orgId)
      .not("month", "in", `(${window.map((m) => `"${m}"`).join(",")})`),
    "tidy up past months",
  );

  return row;
}
