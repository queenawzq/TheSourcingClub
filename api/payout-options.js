import { reply } from "./_stripe.js";
import { tazapayFrom } from "./_tazapay.js";

/**
 * Which withdrawal routes this deploy has set up, for the factory's chooser.
 * Only whether, never a key: a deploy without Tazapay's settings (a preview)
 * shows the chooser as before.
 */
export default async function handler(request, response) {
  if (request.method !== "GET") return reply(response, 405, { error: "method not allowed" });
  let tazapayEnabled = false;
  try {
    tazapayEnabled = Boolean(tazapayFrom());
  } catch {
    tazapayEnabled = false;
  }
  return reply(response, 200, { tazapayEnabled });
}
