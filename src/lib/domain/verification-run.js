/**
 * Starts the verification checks for a company (api/verification-run.js),
 * after it uploads a licence or photos and when it sends its profile for
 * review. Fire and forget: it returns at once, never throws, and nothing on
 * screen waits for it. Staff see the results; a run that fails is run again
 * by the daily job or when staff open the company.
 *
 * Calls for the same company within a few seconds (several photos dropped at
 * once) become one call, after the last of them.
 */

export const SETTLE_MS = 3000;

async function sessionToken() {
  const { supabase } = await import("../supabase.js");
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/** The runner, with what it needs passed in so the check script can drive it. */
export function createVerificationRunner({
  getToken = sessionToken,
  fetchImpl = (...args) => fetch(...args),
  settleMs = SETTLE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const waiting = new Map();

  async function send(orgId) {
    try {
      const token = await getToken();
      if (!token) return;
      await fetchImpl("/api/verification-run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId }),
        // The page may move on (onboarding's next step) before the answer.
        keepalive: true,
      });
    } catch {
      // Never surfaces: the daily job and the staff page run what is missing.
    }
  }

  return function runVerification(orgId) {
    try {
      if (!orgId) return;
      clearTimer(waiting.get(orgId));
      waiting.set(orgId, setTimer(() => {
        waiting.delete(orgId);
        send(orgId);
      }, settleMs));
    } catch {
      // Never throws into the caller's upload or submit.
    }
  };
}

export const runVerification = createVerificationRunner();
