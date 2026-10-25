/**
 * "Keep me logged in" holds across tabs (src/lib/session-storage.mjs).
 *
 * Every hosted test site failed this on 2026-10-23: with the box unticked, a
 * second tab opened already signed in as the first tab's demo account. The
 * demo buttons never passed the box's value, the preference lived in
 * localStorage (shared by every tab), and a tab took on whatever sign-in
 * another tab broadcast. None of it shows in a single tab, which is all a
 * click-through ever exercises, so this runs the adapter as several tabs: one
 * shared localStorage, a sessionStorage each, and supabase-js's broadcast.
 */
import { createSessionStorage } from "../src/lib/session-storage.mjs";

const KEY = "sb-test-auth-token";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const browser = { localStorage: new MemoryStorage(), tabs: [] };

/** A tab: its own sessionStorage, the browser's localStorage, and what it shows. */
function openTab() {
  const win = { localStorage: browser.localStorage, sessionStorage: new MemoryStorage() };
  const tab = { win, ...createSessionStorage(win), shown: null };
  // What AuthProvider does on load: getSession() reads the store.
  tab.shown = JSON.parse(tab.storage.getItem(KEY) ?? "null")?.user ?? null;
  browser.tabs.push(tab);
  return tab;
}

/** supabase-js: save, notify this tab, broadcast to the others (AuthProvider filters). */
function notify(from, session) {
  for (const tab of browser.tabs) {
    if (tab !== from && !tab.isThisTabsSession(KEY, session)) continue;
    tab.shown = session?.user ?? null;
  }
}
function signIn(tab, user, keep) {
  tab.setKeepSignedIn(keep);
  const session = { access_token: `${user}-${Math.random()}`, user };
  tab.storage.setItem(KEY, JSON.stringify(session));
  notify(tab, session);
}
function refresh(tab) {
  const current = JSON.parse(tab.storage.getItem(KEY));
  const session = { ...current, access_token: `${current.user}-${Math.random()}` };
  tab.storage.setItem(KEY, JSON.stringify(session));
  notify(tab, session);
}
function signOut(tab) {
  tab.storage.removeItem(KEY);
  notify(tab, null);
}
const reload = (tab) => JSON.parse(tab.storage.getItem(KEY) ?? "null")?.user ?? null;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
};

// The recorded case: a demo sign-in, box unticked, then a second tab.
const a = openTab();
signIn(a, "demo-brand", false);
check(browser.localStorage.getItem(KEY) === null, "an unticked sign-in writes nothing to localStorage");
const b = openTab();
check(b.shown === null, "a second tab opens signed out");

// Two different sign-ins side by side, both unticked.
signIn(b, "demo-factory", false);
check(a.shown === "demo-brand", "the first tab ignores the second tab's sign-in broadcast");
check(reload(a) === "demo-brand" && reload(b) === "demo-factory", "after a reload each tab holds its own account");
refresh(a);
refresh(b);
check(reload(a) === "demo-brand" && reload(b) === "demo-factory" && a.shown === "demo-brand" && b.shown === "demo-factory",
  "token refreshes keep each tab on its own account");

// A third tab ticks the box: it must not take over the unticked tabs.
const c = openTab();
signIn(c, "demo-admin", true);
check(JSON.parse(browser.localStorage.getItem(KEY)).user === "demo-admin", "a ticked sign-in is kept in localStorage");
refresh(a);
check(JSON.parse(browser.localStorage.getItem(KEY)).user === "demo-admin", "an unticked tab's refresh does not overwrite the kept session");
check(reload(a) === "demo-brand" && a.shown === "demo-brand", "and the unticked tab does not take on the kept one");

// A new tab sees the kept session; tabs sharing it follow each other.
const d = openTab();
check(d.shown === "demo-admin", "a new tab opens with the kept session");
refresh(c);
check(d.shown === "demo-admin" && reload(d) === "demo-admin", "tabs sharing the kept session follow its refresh");

// Signing out of an unticked tab leaves the others alone.
signOut(a);
check(reload(a) === null && a.shown === null, "signing out of an unticked tab signs it out");
check(reload(b) === "demo-factory" && reload(c) === "demo-admin", "and nobody else");
check(reload(a) === null, "and it stays out, rather than taking on the kept session");

// Signing out of the kept session signs out every tab sharing it.
signOut(c);
check(reload(d) === null && d.shown === null, "signing out of the kept session signs out the tabs sharing it");
check(reload(b) === "demo-factory", "but not an unticked tab");

// The password-reset link opens in a new tab and needs the PKCE verifier.
const e = openTab();
e.setKeepSignedIn(false);
e.storage.setItem(`${KEY}-code-verifier`, "verifier");
check(openTab().storage.getItem(`${KEY}-code-verifier`) === "verifier", "the reset link's new tab can read the code verifier");

// A tab signed in unticked by the build before this one (no per-tab choice).
const old = openTab();
old.win.sessionStorage.setItem(KEY, JSON.stringify({ access_token: "old", user: "old-user" }));
check(old.storage.getItem(KEY) !== null && JSON.parse(old.storage.getItem(KEY)).user === "old-user",
  "a session an earlier build kept in this tab is still found");
old.storage.setItem(KEY, JSON.stringify({ access_token: "old2", user: "old-user" }));
check(browser.localStorage.getItem(KEY) === null, "and its refresh stays in the tab");

if (failures) {
  console.error(`\n${failures} check(s) failed: "Keep me logged in" does not hold across tabs.`);
  process.exit(1);
}
console.log("\nKeep me logged in holds across tabs.");
