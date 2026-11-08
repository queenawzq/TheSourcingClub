/**
 * Which way a request reaches the database: to its own host, or through ours.
 *
 * The app talks to <project>.supabase.co directly. For someone on a network
 * that cannot reach that host, the same request goes to /sb/<project>/... on
 * the site they already loaded, which Vercel passes on (vercel.json). Nobody
 * else ever sends a request that way.
 *
 * The rule that shapes everything here: A BROWSER CANNOT TELL "NEVER SENT" FROM
 * "SENT, REPLY LOST". So a write is not repeated because it failed. A write
 * first waits to learn which way is open, then goes one way, once. Only what is
 * safe to send twice is ever sent twice (classify, below).
 *
 * Plain JavaScript with nothing from the browser built in, so
 * scripts/check-sb-fallback.mjs can run every path against a fake network.
 */

/** No direct answer for this long: a read also tries the other way. */
export const HEDGE_MS = 5000;
/** Both ways asked, our host failed, direct still silent: how long before saying so. */
export const GIVE_UP_MS = 10000;
/** The quick look at the direct host. */
export const CHECK_MS = 3000;
/** A direct answer this recent means a write need not look first. */
export const FRESH_MS = 60000;
/** How long a failed direct host is left alone. Survives a reload. */
export const FALLBACK_MS = 10 * 60000;

const STORE_KEY = "tsc-sb-fallback-until";

/**
 * RPCs that only read. `npm run check:sb-fallback` fails if one of these stops
 * being stable in its latest migration. One missing from here is merely not
 * repeated, which is the safe way to be wrong.
 */
export const READ_RPCS = new Set([
  "admin_factory_tier_eligibility", "admin_org_documents", "admin_review_assist_input",
  "admin_review_assists", "admin_review_email_status", "admin_verification_detail",
  "brand_profile_for_factory", "brand_summary_for_factory", "credit_balance", "credit_packs",
  "current_legal_documents", "dashboard_snapshot", "factory_matches_v2", "get_contract_attachments",
  "invitation_preview", "is_platform_admin", "match_score_rfq", "matching_evidence_notes",
  "my_invitation_companies", "my_review_status", "order_activity", "payout_number_reveal_log",
  "public_factory_metrics", "quote_credit_cost", "quote_sample_subtotal", "rfq_last_brand_view",
  "thread_counterparty_time_zone",
]);

/**
 * Writes the server answers correctly when they arrive twice.
 * - signup: the repeat is refused as "already registered", and auth.jsx then
 *   logs in with what was typed (takeRepeated).
 * - token: a password sign-in has no effect to double; a refresh token repeated
 *   inside Supabase's reuse window returns the same new token.
 * - create_org: returns the company the same person and name made in the last
 *   10 minutes (20261106500000).
 */
const REPEATABLE_WRITES = new Set(["/auth/v1/signup", "/auth/v1/token", "/rest/v1/rpc/create_org"]);

/**
 * "read": safe to repeat and to send two ways at once.
 * "repeatable": safe to repeat, never at the same time.
 * "write": once only.
 * Decided on the path alone, so a query string cannot make a write look safe.
 */
export function classify(path, method = "GET") {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return "read";
  if (verb !== "POST") return "write";
  const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
  if (rpc && READ_RPCS.has(rpc[1])) return "read";
  if (/^\/storage\/v1\/object\/(sign|list)(\/|$)/.test(path)) return "read";
  if (REPEATABLE_WRITES.has(path)) return "repeatable";
  return "write";
}

/** The project's id for the /sb address. A local stack has one proxy, "local". */
export function proxyPathFor(url) {
  const project = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(String(url ?? ""));
  return `/sb/${project ? project[1] : "local"}`;
}

/** An answer from Vercel itself (no rewrite, the preview's sign-in), not from the database. */
function isVercelsOwn(response) {
  return !response.ok && /text\/html/i.test(response.headers?.get?.("content-type") ?? "");
}

/**
 * @param {object} options
 * @param {string} options.base        the direct address, with no trailing slash
 * @param {string} options.proxyBase   the same through our host
 * @param {typeof fetch} options.fetch
 * @param {Storage} [options.storage]  remembers the fallback across reloads
 * @param {() => void} [options.onFallback]  called when this page moves to the fallback
 */
export function createRoute({
  base, proxyBase, fetch: send, storage = null, onFallback = () => {},
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let fallbackUntil = 0;
  try {
    fallbackUntil = Number(storage?.getItem(STORE_KEY)) || 0;
  } catch {
    // Storage can be blocked. The look at the host finds the same answer.
  }
  let lastDirectAnswer = 0;
  let checking = null;
  let toldFallback = false;
  const repeated = new Set();
  const failedOver = new Set();

  const onFallbackNow = () => now() < fallbackUntil;

  function useFallback() {
    fallbackUntil = now() + FALLBACK_MS;
    try {
      storage?.setItem(STORE_KEY, String(fallbackUntil));
    } catch {
      // As above.
    }
    if (!toldFallback) {
      toldFallback = true;
      try {
        onFallback();
      } catch {
        // Never surfaces.
      }
    }
    for (const wake of failedOver) wake();
    failedOver.clear();
  }

  function useDirect() {
    lastDirectAnswer = now();
    if (!fallbackUntil) return;
    fallbackUntil = 0;
    try {
      storage?.removeItem(STORE_KEY);
    } catch {
      // As above.
    }
  }

  /**
   * One small look at the direct host, shared by everyone asking. `no-cors`
   * because any reply at all, even a refusal, proves the way is open.
   */
  function check() {
    if (checking) return checking;
    checking = new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimer(() => controller.abort(), CHECK_MS);
      Promise.resolve()
        .then(() => send(`${base}/auth/v1/health`, { mode: "no-cors", cache: "no-store", signal: controller.signal }))
        .then(() => { lastDirectAnswer = now(); })
        .catch(() => useFallback())
        .finally(() => {
          clearTimer(timer);
          checking = null;
          resolve();
        });
    });
    return checking;
  }

  const needsCheck = () => !onFallbackNow() && now() - lastDirectAnswer > FRESH_MS;

  /** A signal for one attempt that also ends when the caller's does. */
  function attempt(signal) {
    const controller = new AbortController();
    if (signal?.aborted) controller.abort();
    const follow = () => controller.abort();
    signal?.addEventListener?.("abort", follow, { once: true });
    return { controller, done: () => signal?.removeEventListener?.("abort", follow) };
  }

  /** Through our host. Vercel's own answer is a failure, flagged as never having reached the database. */
  async function viaProxy(path, init) {
    const response = await send(`${proxyBase}${path}`, init);
    if (isVercelsOwn(response)) {
      const failure = new TypeError("Failed to fetch");
      failure.neverReachedDatabase = response.status < 500;
      throw failure;
    }
    return response;
  }

  /** Direct, recording what the answer says about the way being open. */
  async function viaDirect(path, init) {
    const response = await send(`${base}${path}`, init);
    useDirect();
    return response;
  }

  const callerStopped = (init) => Boolean(init?.signal?.aborted);

  /** A read: direct, and the other way too once direct looks stuck. First usable answer wins. */
  function read(path, init) {
    return new Promise((resolve, reject) => {
      const direct = attempt(init?.signal);
      const proxy = attempt(init?.signal);
      let settled = false;
      let proxyStarted = false;
      let directFailure = null;
      let proxyFailure = null;
      let directFinished = false;
      let timer = null;

      const finishWith = (response, loser) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        failedOver.delete(startProxy);
        loser.controller.abort();
        direct.done();
        proxy.done();
        resolve(response);
      };
      const failIfBothDone = () => {
        if (settled || !directFinished || (proxyStarted && !proxyFailure) || !proxyStarted) return;
        settled = true;
        clearTimer(timer);
        failedOver.delete(startProxy);
        direct.done();
        proxy.done();
        reject(directFailure ?? proxyFailure);
      };

      function startProxy() {
        if (proxyStarted || settled) return;
        proxyStarted = true;
        viaProxy(path, { ...init, signal: proxy.controller.signal }).then(
          (response) => {
            useFallback();
            finishWith(response, direct);
          },
          (failure) => {
            proxyFailure = failure;
            failIfBothDone();
            // Direct may only be slow, so it gets a while longer. Not forever:
            // a connection that hangs would leave the screen waiting with no words.
            if (!settled) {
              clearTimer(timer);
              timer = setTimer(() => {
                directFailure = directFailure ?? failure;
                directFinished = true;
                direct.controller.abort();
                failIfBothDone();
              }, GIVE_UP_MS);
            }
          },
        );
      }

      viaDirect(path, { ...init, signal: direct.controller.signal }).then(
        (response) => finishWith(response, proxy),
        (failure) => {
          directFailure = failure;
          directFinished = true;
          if (callerStopped(init)) {
            if (!settled) {
              settled = true;
              clearTimer(timer);
              failedOver.delete(startProxy);
              reject(failure);
            }
            return;
          }
          startProxy();
          failIfBothDone();
        },
      );
      timer = setTimer(startProxy, HEDGE_MS);
      // The look at the host says it is shut: no need to wait out the timer.
      failedOver.add(startProxy);
    });
  }

  /** On the fallback already, a read still tries direct if our host fails: the way may have opened. */
  async function readOnFallback(path, init) {
    try {
      return await viaProxy(path, init);
    } catch (failure) {
      if (callerStopped(init)) throw failure;
      try {
        return await viaDirect(path, init);
      } catch {
        throw failure;
      }
    }
  }

  async function write(path, init, kind) {
    if (needsCheck()) await check();

    if (onFallbackNow()) {
      try {
        return await viaProxy(path, init);
      } catch (failure) {
        // Our host answered for itself, so nothing reached the database. Or it
        // is safe to send again. Otherwise it stops here, whatever it was.
        if (callerStopped(init) || (!failure.neverReachedDatabase && kind !== "repeatable")) throw failure;
        if (kind === "repeatable" && !failure.neverReachedDatabase) repeated.add(path);
        try {
          return await viaDirect(path, init);
        } catch {
          throw failure;
        }
      }
    }

    // Still no answer after a while: this one is left to finish, and whatever
    // the person does next goes the way that is open.
    const stuck = setTimer(() => { check(); }, HEDGE_MS);
    try {
      return await viaDirect(path, init);
    } catch (failure) {
      if (callerStopped(init)) throw failure;
      useFallback();
      if (kind !== "repeatable") throw failure;
      repeated.add(path);
      try {
        return await viaProxy(path, init);
      } catch {
        throw failure;
      }
    } finally {
      clearTimer(stuck);
    }
  }

  return {
    /** Stands in for fetch in createClient. Anything not for the database is passed straight on. */
    fetch(input, init) {
      const address = typeof input === "string" ? input : input instanceof URL ? input.href : null;
      if (!address || !address.startsWith(`${base}/`)) return send(input, init);
      const path = address.slice(base.length);
      const kind = classify(path.split("?")[0], init?.method);
      if (kind !== "read") return write(path, init, kind);
      if (onFallbackNow()) return readOnFallback(path, init);
      // Once this page has had a direct answer, the timer in read() is enough.
      if (!lastDirectAnswer) check();
      return read(path, init);
    },
    /** A file's link, for an <img> or a new tab: these never pass through fetch. */
    fileUrl(url) {
      return onFallbackNow() && String(url ?? "").startsWith(`${base}/`) ? `${proxyBase}${url.slice(base.length)}` : url;
    },
    isOnFallback: onFallbackNow,
    /** Was this write sent a second time after a lost reply? Asked once, then forgotten. */
    takeRepeated(path) {
      for (const sent of repeated) {
        if (sent.split("?")[0] === path) {
          repeated.delete(sent);
          return true;
        }
      }
      return false;
    },
  };
}
