/**
 * The company's calls for a dashboard, with the other side's time zone for
 * each conversation that has one open. Never throws: a dashboard without its
 * call card is still a dashboard.
 *
 * It keeps itself current while the dashboard stays open: a call proposed,
 * answered or cancelled by the other side reloads the list (calls are in the
 * Realtime publication, 20261014000300), and its clock (`useCallClock`)
 * moves so "Join call" appears and an ended call leaves without a refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { callState, counterpartyTimeZone, listCalls, nextCallChange } from "../../lib/domain/calls.js";

export function useDashboardCalls(orgId) {
  const [calls, setCalls] = useState([]);
  const [zones, setZones] = useState({});
  const [now, setNow] = useCallClock(calls);
  const latest = useRef(0);

  const load = useCallback(async () => {
    // Two changes close together: only the last load is drawn.
    const run = latest.current + 1;
    latest.current = run;
    try {
      const rows = await listCalls(orgId);
      if (latest.current !== run) return;
      setCalls(rows);
      setNow(Date.now());
      const threads = [...new Set(rows
        .filter((call) => ["invite", "upcoming", "live"].includes(callState(call, orgId)))
        .map((call) => call.thread_id))];
      // Asked again on every load: the other side may have moved time zone.
      const found = await Promise.all(threads.map((id) => counterpartyTimeZone(id)));
      if (latest.current === run) setZones(Object.fromEntries(threads.map((id, index) => [id, found[index]])));
    } catch (failure) {
      // The card keeps what it last showed.
      console.warn("dashboard calls", failure?.message);
    }
  }, [orgId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`dashboard-calls:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => load())
      .subscribe();
    return () => {
      latest.current += 1;
      supabase.removeChannel(channel);
    };
  }, [orgId, load]);

  return { calls, zones, now };
}

// The longest a clock sleeps between checks: setTimeout cannot wait more than
// ~24.8 days, and a long sleep is a long time to be wrong if the computer's
// clock is changed under it.
const LONGEST_WAIT = 60 * 60000;

/**
 * The time a page's call cards are read at: `[now, setNow]`.
 *
 * It wakes at the moment the next call changes state (`nextCallChange`), not
 * on a fixed poll. A poll started whenever the page happened to open showed
 * "Join call" anywhere up to a whole period after the window opened, and a
 * dashboard left open read "Open" until it was reloaded. A hidden tab's timers
 * are slowed by the browser, so coming back to the tab reads the time again
 * at once.
 */
export function useCallClock(calls) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const next = nextCallChange(calls, Date.now());
    if (next === null) return undefined;
    // A little after the moment, so the state has changed when it is read.
    const wait = Math.min(Math.max(next - Date.now(), 0) + 250, LONGEST_WAIT);
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [calls, now]);

  useEffect(() => {
    const read = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => {
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("focus", read);
    };
  }, []);

  return [now, setNow];
}
