/**
 * "Keep me logged in", made real: where the Supabase session is kept.
 *
 * The designed login screen offers the choice, so it has to mean something.
 * Checked, the session goes to localStorage and survives closing the browser;
 * unchecked, it goes to sessionStorage and dies with the tab — which is what
 * someone ticking nothing on a shared machine is asking for.
 *
 * The choice belongs to the TAB, and is kept in that tab's sessionStorage. It
 * used to live in localStorage, which every tab shares, and that broke both
 * ways: a second tab signing in with the box ticked flipped the first tab's
 * next token refresh into localStorage (over the second tab's session), and a
 * tab that had signed in unticked read localStorage first, so it took on
 * whichever remembered session another tab had left there.
 *
 * - A tab that chose "only this tab" reads, writes and removes its session in
 *   sessionStorage alone. It never touches localStorage, which holds someone
 *   else's remembered sign-in, not its own.
 * - A tab that chose "keep" — or made no choice and holds nothing of its own,
 *   e.g. a new tab or a reopened browser — uses localStorage, shared by every
 *   such tab.
 * - The PKCE code verifier always goes to localStorage: the password-reset
 *   link it belongs to opens in a NEW tab, which must be able to read it.
 *
 * Pure (it takes the window), so scripts/check-auth-storage.mjs can run two
 * simulated tabs against it.
 *
 * Every accessor is wrapped. Storage throws rather than returning null in a
 * locked-down browser, and an exception here happens before any error
 * boundary exists — it is a white page, not a message.
 */
export const KEEP_KEY = "tscKeepSignedIn";

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function createSessionStorage(win) {
  const local = () => win.localStorage;
  const tab = () => win.sessionStorage;

  /** True when this tab keeps `key` to itself (sessionStorage). */
  const tabOnly = (key) => {
    if (key.endsWith("-code-verifier")) return false;
    const choice = safe(() => tab().getItem(KEEP_KEY));
    if (choice === "0") return true;
    if (choice === "1") return false;
    // No choice made in this tab: a session it already holds in
    // sessionStorage was signed in unticked (by an earlier build).
    return safe(() => tab().getItem(key)) !== null;
  };

  const storage = {
    getItem(key) {
      return tabOnly(key)
        ? safe(() => tab().getItem(key))
        : safe(() => local().getItem(key));
    },
    setItem(key, value) {
      if (tabOnly(key)) {
        safe(() => tab().setItem(key, value));
      } else {
        safe(() => local().setItem(key, value));
        safe(() => tab().removeItem(key));
      }
    },
    removeItem(key) {
      if (tabOnly(key)) {
        safe(() => tab().removeItem(key));
      } else {
        safe(() => local().removeItem(key));
        safe(() => tab().removeItem(key));
      }
    },
  };

  /** Called right before a sign-in, with what the screen's checkbox says. */
  function setKeepSignedIn(keep) {
    safe(() => tab().setItem(KEEP_KEY, keep ? "1" : "0"));
  }

  /**
   * Whether an auth event's session is the one this tab holds under
   * `storageKey`. supabase-js broadcasts every sign-in, sign-out and refresh
   * to all tabs on the site; a tab keeping its own sign-in must not take on
   * another tab's. A tab's own events always match, because supabase-js
   * saves the session before it notifies.
   */
  function isThisTabsSession(storageKey, session) {
    const stored = safe(() => JSON.parse(storage.getItem(storageKey) ?? "null"));
    return (stored?.access_token ?? null) === (session?.access_token ?? null);
  }

  return { storage, setKeepSignedIn, isThisTabsSession };
}
