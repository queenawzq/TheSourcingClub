/**
 * One seam between the designed UI and where its data comes from.
 *
 * The prototypes have to keep rendering with no database. Queena opens
 * prototype.html, sees populated screens and iterates on visuals; the moment a
 * screen needs a live query that loop breaks and design work stops. So the
 * same components are mounted twice against two adapters:
 *
 *   prototype.html  → mock adapter, serving the constants already in the file
 *   app.html        → live adapter, backed by src/lib/domain/*
 *
 * One copy of the UI, no fork, and `git merge origin/main` keeps working.
 *
 * Every hook returns the same shape — { data, loading, error, reload } — even
 * for the mock, where loading is never true. Screens that handle it correctly
 * against the mock then handle it correctly against the network, which is the
 * whole point: there is not one loading or error state anywhere in the 14,000
 * lines of prototype today, and those states are where a port silently
 * regresses.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const DataContext = createContext(null);

export function DataProvider({ adapter, children }) {
  return <DataContext.Provider value={adapter}>{children}</DataContext.Provider>;
}

function useAdapter() {
  const adapter = useContext(DataContext);
  if (!adapter) {
    throw new Error(
      "No DataProvider above this component. Mount through src/prototype/entry.jsx " +
        "(mock) or src/app/main.jsx (live) rather than rendering App directly.",
    );
  }
  return adapter;
}

/**
 * Run one adapter method as a resource.
 *
 * A synchronous adapter (the mock) resolves before first paint, so a mock
 * render never flashes a spinner — the prototype looks exactly as it does
 * today.
 */
export function useResource(name, ...args) {
  const adapter = useAdapter();
  const method = adapter[name];
  const key = JSON.stringify(args);

  const [state, setState] = useState(() => {
    if (!method) return { data: null, loading: false, error: new Error(`no adapter method "${name}"`) };
    const first = method(...args);
    // The mock returns a value; the live adapter returns a promise.
    return typeof first?.then === "function"
      ? { data: null, loading: true, error: null, pending: first }
      : { data: first, loading: false, error: null };
  });

  const reload = useCallback(() => {
    if (!method) return;
    const result = method(...args);
    if (typeof result?.then !== "function") {
      setState({ data: result, loading: false, error: null });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    result.then(
      (data) => setState({ data, loading: false, error: null }),
      (error) => setState({ data: null, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key]);

  useEffect(() => {
    let cancelled = false;
    if (state.pending) {
      state.pending.then(
        (data) => !cancelled && setState({ data, loading: false, error: null }),
        (error) => !cancelled && setState({ data: null, loading: false, error }),
      );
      return () => { cancelled = true; };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run when the arguments change, but not on first mount, which the
  // initialiser above already handled.
  const [seenKey, setSeenKey] = useState(key);
  useEffect(() => {
    if (key === seenKey) return;
    setSeenKey(key);
    reload();
  }, [key, seenKey, reload]);

  return { data: state.data, loading: state.loading, error: state.error, reload };
}

/* -------------------------------------------------------------------------- */
/* The vocabulary screens use. One per thing a screen asks for.               */
/* -------------------------------------------------------------------------- */

export const useOrders = () => useResource("orders");
export const useOrder = (id) => useResource("order", id);
export const useMilestones = (orderId) => useResource("milestones", orderId);
export const useRfqs = () => useResource("rfqs");
export const useThreads = () => useResource("threads");
export const useDashboard = () => useResource("dashboard");

/** Who is looking, and which side they are on. */
export function useViewer() {
  return useAdapter().viewer ?? { isFactory: false, org: null, user: null };
}
