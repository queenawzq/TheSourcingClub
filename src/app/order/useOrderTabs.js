/**
 * The live side of the order list's tabs, for both designed lists.
 *
 * The designed pages keep their tabs in local state, which is what the
 * prototypes still run on. Live, they are handed this store instead: the same
 * `{ key, label, locked }` shape the pages already draw, read from the
 * company's `order_tabs`, plus which orders sit in each.
 *
 * Active and Closed keep the keys "active" and "closed", so the pages' own
 * active/closed filtering is untouched; a custom tab's key is its id.
 * Every change reloads afterwards rather than guessing, like the order screen.
 */
import { useCallback, useEffect, useState } from "react";
import {
  addOrderTab,
  addOrderToTab,
  listOrderTabs,
  removeOrderFromTab,
  saveOrderTabs,
} from "../../lib/domain/order-tabs.js";

const DEFAULT_TABS = [
  { key: "active", kind: "active", label: "Active orders", locked: true },
  { key: "closed", kind: "closed", label: "Closed", locked: true },
];

function toTab(row) {
  const locked = row.kind !== "custom";
  return { key: locked ? row.kind : row.id, id: row.id, kind: row.kind, label: row.label, locked };
}

export default function useOrderTabs(org, user) {
  const orgId = org?.id ?? null;
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [addError, setAddError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setRows(await listOrderTabs(orgId));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const tabs = rows.length ? rows.map(toTab) : DEFAULT_TABS;
  const membership = new Map(rows.map((row) => [row.id, new Set(row.orderIds)]));

  /** Resolves to the new tab's key, or null when it was refused. */
  const add = useCallback(async (label) => {
    setAddError(null);
    try {
      const created = await addOrderTab(orgId, label);
      await load();
      return created?.id ?? null;
    } catch (err) {
      setAddError(err);
      return null;
    }
  }, [orgId, load]);

  /** Resolves true once saved, so the window knows whether to close. */
  const save = useCallback(async (draftTabs) => {
    setSaveError(null);
    try {
      await saveOrderTabs(orgId, draftTabs.map((tab) => ({
        id: tab.id,
        kind: tab.kind ?? (tab.locked ? tab.key : "custom"),
        label: tab.label,
      })));
      await load();
      return true;
    } catch (err) {
      setSaveError(err);
      return false;
    }
  }, [orgId, load]);

  /** In or out of a custom tab, whichever it is not. */
  const toggle = useCallback(async (tabKey, orderId) => {
    setError(null);
    try {
      if (membership.get(tabKey)?.has(orderId)) await removeOrderFromTab(tabKey, orderId);
      else await addOrderToTab(tabKey, orderId, user?.id);
      await load();
    } catch (err) {
      setError(err);
    }
  }, [membership, user?.id, load]);

  return {
    tabs,
    membership,
    error,
    addError,
    saveError,
    clearErrors: () => { setAddError(null); setSaveError(null); },
    add,
    save,
    toggle,
  };
}
