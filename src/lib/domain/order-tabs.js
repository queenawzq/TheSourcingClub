/**
 * A company's order tabs: "Active orders", "Closed", and the ones it adds.
 *
 * Tabs belong to the company, not the person, and the other side of an order
 * never sees them. Active and Closed are rows too, written by the first add
 * or save; a company with none yet is shown the defaults, and reading never
 * writes.
 */
import { supabase, unwrap } from "../supabase.js";

/** The company's tabs in display order, each with the ids of its orders. */
export async function listOrderTabs(orgId) {
  const rows = unwrap(
    await supabase
      .from("order_tabs")
      .select("id, kind, label, sort, order_tab_orders (order_id)")
      .eq("org_id", orgId)
      .order("sort", { ascending: true }),
    "load your order tabs",
  );
  return (rows ?? []).map(({ order_tab_orders: filed, ...tab }) => ({
    ...tab,
    orderIds: (filed ?? []).map((row) => row.order_id),
  }));
}

/** "+ Add tab": appends one tab, never sends the rest of the list. */
export async function addOrderTab(orgId, label) {
  return unwrap(
    await supabase.rpc("add_order_tab", { target_org: orgId, new_label: label }),
    "add the tab",
  );
}

/**
 * "Manage tabs" → Save changes: the whole list, in order. A custom tab left
 * out is deleted; Active and Closed must stay in it.
 */
export async function saveOrderTabs(orgId, tabs) {
  return unwrap(
    await supabase.rpc("save_order_tabs", {
      target_org: orgId,
      tabs: tabs.map(({ id, kind, label }) => (id ? { id, kind, label } : { kind, label })),
    }),
    "save your tabs",
  );
}

export async function addOrderToTab(tabId, orderId, userId) {
  return unwrap(
    await supabase.from("order_tab_orders").insert({ tab_id: tabId, order_id: orderId, added_by: userId }),
    "add the order to the tab",
  );
}

export async function removeOrderFromTab(tabId, orderId) {
  return unwrap(
    await supabase.from("order_tab_orders").delete().eq("tab_id", tabId).eq("order_id", orderId),
    "take the order out of the tab",
  );
}
