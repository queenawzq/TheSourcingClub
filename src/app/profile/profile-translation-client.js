import { supabase } from "../../lib/supabase.js";

// Deduplicate simultaneous cards/profile views. Server cache is keyed by source text.
const pending = new Map();
export async function requestProfileTranslation(orgId) {
  if (pending.has(orgId)) return pending.get(orgId);
  const request = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/profile-translation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ orgId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Translation unavailable");
    return data;
  })();
  pending.set(orgId, request);
  try { return await request; }
  finally { pending.delete(orgId); }
}
