/**
 * What is waiting for you.
 *
 * One round trip to one SQL function, so the home screen cannot disagree with
 * the screens it links to. Nothing here counts or sums in JavaScript.
 */
import { supabase, unwrap } from "../supabase.js";

export async function dashboardSnapshot(orgId) {
  const rows = unwrap(
    await supabase.rpc("dashboard_snapshot", { target_org: orgId }),
    "load your dashboard",
  );
  return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
}
