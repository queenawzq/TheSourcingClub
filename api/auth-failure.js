import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

/**
 * A browser saying a sign-in or sign-up got no answer from the database.
 *
 * Open to anyone, since the person has no session by definition. So it takes
 * only values from short lists, stores no address or IP, and is limited per
 * client in the database, with the IP hashed in the limiter's key. Always
 * answers 204: nothing on the page waits for this or can act on it.
 */

const STAGES = new Set(["signup", "login", "reset", "code", "company"]);
const KINDS = new Set(["network", "timeout"]);
const PORTALS = new Set(["brand", "factory"]);
const LANGUAGE = /^[A-Za-z-]{2,16}$/;
const COUNTRY = /^[A-Z]{2}$/;

function readBody(request) {
  try {
    return typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};
  } catch {
    return {};
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }

  const { stage, kind, portal, language } = readBody(request);
  const { supabaseUrl, serviceKey } = supabaseServerEnv();
  if (!STAGES.has(stage) || !KINDS.has(kind) || !PORTALS.has(portal) || !supabaseUrl || !serviceKey) {
    response.status(204).end();
    return;
  }

  try {
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const clientIp = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
    const key = `auth-failure:${createHash("sha256").update(clientIp).digest("hex").slice(0, 32)}`;
    const { data: allowed } = await service.rpc("claim_email_probe", { probe_ip: key });
    if (allowed) {
      const country = String(request.headers["x-vercel-ip-country"] ?? "");
      await service.from("auth_connection_failures").insert({
        stage,
        kind,
        portal,
        language: LANGUAGE.test(String(language)) ? language : null,
        country: COUNTRY.test(country) ? country : null,
      });
    }
  } catch {
    // Nobody is waiting on this.
  }
  response.status(204).end();
}
