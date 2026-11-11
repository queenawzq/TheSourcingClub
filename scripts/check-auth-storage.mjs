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
import { readFileSync } from "node:fs";
import { createSessionStorage } from "../src/lib/session-storage.mjs";
import { takeRecoveryToken } from "../src/lib/recovery-link.mjs";

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
    if (!session) tab.setKeepSignedIn(false); // AuthProvider, on SIGNED_OUT
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
// signUpWithPassword: the sign-up form has no "Keep me logged in" box.
function signUp(tab, user) {
  tab.keepNewAccount(KEY);
  const session = { access_token: `${user}-${Math.random()}`, user };
  tab.storage.setItem(KEY, JSON.stringify(session));
  notify(tab, session);
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

// Signing up in one tab never changes another tab's account (Nov 7: three
// testers on one machine; one's onboarding answers went into another's company).
const fresh = () => { browser.localStorage.map.clear(); browser.tabs = []; };
fresh();
const only = openTab();
signIn(only, "tester-x", false);
const joiner = openTab();
signUp(joiner, "tester-y");
check(only.shown === "tester-x" && reload(only) === "tester-x", "a sign-up next door leaves a this-tab-only tab on its account");
check(joiner.shown === "tester-y" && reload(joiner) === "tester-y", "and the new account is signed in, in its own tab");
check(JSON.parse(browser.localStorage.getItem(KEY)).user === "tester-y", "a new account with nobody kept is kept, like a ticked sign-in");
const joinerTwo = openTab();
check(joinerTwo.shown === "tester-y", "so a new tab opens as the new account");

fresh();
const kept = openTab();
signIn(kept, "tester-x", true);
const keptTwo = openTab();
check(keptTwo.shown === "tester-x", "(a second tab shares the kept sign-in)");
// The signup form shows beside a kept sign-in in a tab that signed in "this
// tab only" and signed out again: it reads its own, empty, sessionStorage.
const signer = openTab();
signIn(signer, "tester-z", false);
signOut(signer);
check(signer.shown === null && kept.shown === "tester-x", "(a this-tab-only tab signed out beside it)");
signUp(signer, "tester-y");
check(kept.shown === "tester-x" && reload(kept) === "tester-x", "a sign-up next door leaves a kept tab on its account");
check(keptTwo.shown === "tester-x" && reload(keptTwo) === "tester-x", "and every tab sharing the kept sign-in");
check(signer.shown === "tester-y" && reload(signer) === "tester-y", "while the new account is signed in, in its own tab only");
refresh(signer);
check(JSON.parse(browser.localStorage.getItem(KEY)).user === "tester-x" && kept.shown === "tester-x",
  "and its token refresh does not overwrite the kept sign-in");

// Flows test, Nov 8: a kept sign-in, a new tab opened as that person, Log out
// there (the only way to reach sign-up), then sign up. The first tab went on
// drawing its screen as the new account and saved its answers on that company.
fresh();
const firstTab = openTab();
signIn(firstTab, "tester-a", true);
const newTab = openTab();
check(newTab.shown === "tester-a", "(a new tab opens as the kept sign-in)");
signOut(newTab);
check(firstTab.shown === null, "logging out there signs the first tab out");
signUp(newTab, "tester-b");
check(newTab.shown === "tester-b" && reload(newTab) === "tester-b", "the new account is signed in where it was made");
check(firstTab.shown === null && reload(firstTab) === null, "and the tab signed out next door does not become the new account");
refresh(newTab);
check(firstTab.shown === null, "nor when the new account's token refreshes");
check(openTab().shown === "tester-b", "a tab opened afterwards is the new account, which nobody else keeps");
signIn(firstTab, "tester-a", false);
check(firstTab.shown === "tester-a" && newTab.shown === "tester-b" && reload(firstTab) === "tester-a" && reload(newTab) === "tester-b",
  "and the first tab can sign back in beside it, two sign-ins side by side");
fresh();

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

// The reset email links to our own page with the token in the fragment
// (src/lib/recovery-link.mjs): read once, and gone from the address at once.
const linkWindow = (href) => {
  const win = { location: new URL(href), history: { state: null, replaceState(_s, _t, next) { win.location = new URL(next); } } };
  return win;
};
const linked = linkWindow("https://example.test/app.html?reset=1#token_hash=pkce_0a1b2c3d4e5f60718293a4b5c6d7e8f9&type=recovery");
check(takeRecoveryToken(linked) === "pkce_0a1b2c3d4e5f60718293a4b5c6d7e8f9", "the reset link's token is read from the fragment");
check(linked.location.href === "https://example.test/app.html?reset=1", "and taken out of the address, keeping ?reset=1");
check(takeRecoveryToken(linked) === null, "so a refresh does not use it again");
check(takeRecoveryToken(linkWindow("https://example.test/app.html#token_hash=abc&type=signup")) === null, "another kind of link is left alone");
check(takeRecoveryToken(linkWindow("https://example.test/app.html?reset=1&code=xyz")) === null, "a link from before (?code=) is left to supabase-js");
const keepOther = linkWindow("https://example.test/app.html?reset=1#type=recovery&token_hash=abc&tab=x");
check(takeRecoveryToken(keepOther) === "abc" && keepOther.location.hash === "#tab=x", "the rest of the fragment stays");

// notify() above stands in for AuthProvider; this is the line it stands in for.
check(/event === "SIGNED_OUT"\) setKeepSignedIn\(false\)/.test(readFileSync("src/lib/auth.jsx", "utf8")),
  "AuthProvider parks a signed-out tab");

if (failures) {
  console.error(`\n${failures} check(s) failed: "Keep me logged in" does not hold across tabs.`);
  process.exit(1);
}
console.log("\nKeep me logged in holds across tabs.");
