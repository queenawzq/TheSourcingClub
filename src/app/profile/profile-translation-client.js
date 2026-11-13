import { supabase } from "../../lib/supabase.js";

async function post(body, signal) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/profile-translation", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Translation unavailable");
  return data;
}

/** The vendor page: `{ translations, incomplete }`. */
export function requestProfileTranslation(orgId, signal) {
  return post({ orgId }, signal);
}

/** Browse and dashboard cards, in one request (B7): `{ [orgId]: { translations, incomplete } }`. */
export async function requestCardTranslations(orgIds, signal) {
  return (await post({ orgIds, scope: "card" }, signal)).byOrg ?? {};
}
