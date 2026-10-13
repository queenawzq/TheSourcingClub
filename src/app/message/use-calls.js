/**
 * The company's calls for a dashboard, with the other side's time zone for
 * each conversation that has one open. Never throws: a dashboard without its
 * call card is still a dashboard.
 */
import { useEffect, useState } from "react";
import { callState, counterpartyTimeZone, listCalls } from "../../lib/domain/calls.js";

export function useDashboardCalls(orgId) {
  const [calls, setCalls] = useState([]);
  const [zones, setZones] = useState({});

  useEffect(() => {
    let cancelled = false;
    listCalls(orgId)
      .then(async (rows) => {
        if (cancelled) return;
        setCalls(rows);
        const threads = [...new Set(rows
          .filter((call) => ["invite", "upcoming", "live"].includes(callState(call, orgId)))
          .map((call) => call.thread_id))];
        const found = await Promise.all(threads.map((id) => counterpartyTimeZone(id)));
        if (!cancelled) setZones(Object.fromEntries(threads.map((id, index) => [id, found[index]])));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [orgId]);

  return { calls, zones };
}
