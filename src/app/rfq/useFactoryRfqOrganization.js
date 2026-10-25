import { useEffect, useRef, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";

export default function useFactoryRfqOrganization(orgId) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    supabase.from("factory_rfq_organization").select("settings").eq("org_id", orgId).maybeSingle()
      .then((result) => { const row = unwrap(result); if (!cancelled) setSettings(row?.settings ?? {}); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [orgId]);
  const save = async (patch) => {
    if (saving.current || settings == null) return false;
    saving.current = true; setBusy(true); setError(null);
    try {
      const next = { ...settings, ...patch };
      unwrap(await supabase.from("factory_rfq_organization").upsert({ org_id: orgId, settings: next }));
      setSettings(next);
      return true;
    } catch (err) { setError(err); return false; }
    finally { saving.current = false; setBusy(false); }
  };
  return { settings, error, busy, save };
}
