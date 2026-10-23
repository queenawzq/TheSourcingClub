/**
 * The company's calls for a dashboard, with the other side's time zone for
 * each conversation that has one open. Never throws: a dashboard without its
 * call card is still a dashboard.
 *
 * It keeps itself current while the dashboard stays open: a call proposed,
 * answered or cancelled by the other side reloads the list (calls are in the
 * Realtime publication, 20261014000300), and `now` ticks so "Join call"
 * appears and an ended call leaves without a refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { callState, counterpartyTimeZone, listCalls } from "../../lib/domain/calls.js";

export function useDashboardCalls(orgId) {
  const [calls, setCalls] = useState([]);
  const [zones, setZones] = useState({});
  const [now, setNow] = useState(() => Date.now());
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
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      latest.current += 1;
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [orgId, load]);

  return { calls, zones, now };
}
