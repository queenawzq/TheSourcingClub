/**
 * The brand's saved vendors, for the "Save" / "Saved" buttons on Browse
 * vendors and a vendor's profile. saved_factories is the brand's own list;
 * nobody else reads it, the vendor included.
 */
import { useCallback, useEffect, useState } from "react";
import { listSavedFactories, saveFactory, unsaveFactory } from "../../lib/domain/rfq.js";

export function useSavedVendors(org, user) {
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(() => new Set());
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listSavedFactories(org.id).then(
      (rows) => !cancelled && setSaved(new Set(rows.map((row) => row.factory_org_id))),
      (failure) => !cancelled && setError(failure),
    );
    return () => { cancelled = true; };
  }, [org.id]);

  const toggle = useCallback(async (vendorOrgId) => {
    if (!saved || busy.has(vendorOrgId)) return;
    const wasSaved = saved.has(vendorOrgId);
    setError(null);
    setBusy((current) => new Set(current).add(vendorOrgId));
    try {
      if (wasSaved) await unsaveFactory(org.id, vendorOrgId);
      else await saveFactory(org.id, vendorOrgId, user.id);
      setSaved((current) => {
        const next = new Set(current);
        if (wasSaved) next.delete(vendorOrgId);
        else next.add(vendorOrgId);
        return next;
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(vendorOrgId);
        return next;
      });
    }
  }, [org.id, user?.id, saved, busy]);

  /** The `save` a designed card or profile takes, or null while loading. */
  const saveFor = (vendorOrgId) => (saved
    ? { saved: saved.has(vendorOrgId), busy: busy.has(vendorOrgId), onToggle: () => toggle(vendorOrgId) }
    : null);

  return { saved, saveFor, error };
}
