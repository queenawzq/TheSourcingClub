import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { serviceClient } from "./_notification-sender.js";
import { sendResubmissionAlerts } from "./_review-decision-sender.js";

/**
 * The company's kick after it sends its profile back (resubmit_for_review).
 *
 * The database queued the email to staff in the same transaction; this only
 * sends what is due for the caller's own company, so a member cannot make it
 * send anything else, and calling it twice sends nothing twice. If it never
 * runs, the daily job sends it.
 */
const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ sent: 0, error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  const authorization = request.headers.authorization;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(503).json({ sent: 0, error: "email is not set up on this site" });
    return;
  }
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ sent: 0, error: "sign in is required" });
    return;
  }
  const orgId = String(jsonBody(request).orgId ?? "");
  if (!ORG_ID.test(orgId)) {
    response.status(400).json({ sent: 0, error: "a valid organization id is required" });
    return;
  }

  // Membership, read with the caller's token.
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: isMember, error: memberError } = await caller.rpc("is_org_member", { target_org: orgId });
  if (memberError || isMember !== true) {
    response.status(403).json({ sent: 0, error: "only a member of this company can do that" });
    return;
  }

  try {
    const result = await sendResubmissionAlerts(serviceClient(supabaseUrl, serviceKey), request, { orgId });
    response.status(200).json({ ...result, error: null });
  } catch (error) {
    console.error("review-resubmitted:", error.message);
    response.status(500).json({ sent: 0, error: "the email to staff will be sent by the daily job" });
  }
}
