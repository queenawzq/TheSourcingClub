/**
 * Which company a tab is working in, kept per tab.
 *
 * It used to live in localStorage alone, which every tab shares: choosing the
 * factory workspace in one tab, or another person's tab reloading and falling
 * back to its own first company, changed what every other tab opened on at its
 * next reload. A brand tab then reloaded as the factory ("Only the brand sets
 * the production steps").
 *
 * - The tab's choice is in its own sessionStorage, and a reload reads that.
 * - A new tab starts from the last company chosen in this browser
 *   (localStorage), copied into the tab at once, so a later choice in another
 *   tab does not move it.
 * - Choosing a company in the switcher writes both: this tab, and the default
 *   for the next new tab.
 * - Falling back because the stored company is not one of the signed-in
 *   person's writes this tab only. That stored id may be another person's,
 *   and their tabs keep it.
 * - Whatever is stored, only a company in the person's own list is ever used.
 *
 * Pure (it takes the window), so scripts/check-auth-storage.mjs can run
 * several simulated tabs against it. Every accessor is wrapped: storage throws
 * in a locked-down browser.
 */
export const ACTIVE_ORG_KEY = "tscActiveOrg";

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function createActiveOrgStorage(win) {
  const local = () => win.localStorage;
  const tab = () => win.sessionStorage;

  /** This tab's company id, seeding a new tab from the browser's last choice. */
  function read() {
    const own = safe(() => tab().getItem(ACTIVE_ORG_KEY));
    if (own) return own;
    const seed = safe(() => local().getItem(ACTIVE_ORG_KEY)) || null;
    if (seed) safe(() => tab().setItem(ACTIVE_ORG_KEY, seed));
    return seed;
  }

  /** The person chose a company: this tab, and the next new tab. */
  function choose(orgId) {
    safe(() => tab().setItem(ACTIVE_ORG_KEY, orgId));
    safe(() => local().setItem(ACTIVE_ORG_KEY, orgId));
  }

  /** The stored company is not one of theirs: change this tab only. */
  function fallBack(orgId) {
    safe(() => tab().setItem(ACTIVE_ORG_KEY, orgId));
  }

  /** Signed out in this tab. */
  function clear() {
    safe(() => tab().removeItem(ACTIVE_ORG_KEY));
    safe(() => local().removeItem(ACTIVE_ORG_KEY));
  }

  return { read, choose, fallBack, clear };
}

/** The company to show: the stored one only if it is in the person's list. */
export function pickActiveOrg(orgs, activeOrgId) {
  return orgs.find((org) => org.id === activeOrgId) ?? orgs[0] ?? null;
}
