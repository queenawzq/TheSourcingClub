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
import { rememberReturn, restoreReturn } from "../src/lib/return-after-link.mjs";
import { ACTIVE_ORG_KEY, createActiveOrgStorage, pickActiveOrg } from "../src/lib/active-org-storage.mjs";

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

// The sign-in box shows this tab's own choice (keepChoice), never a ticked box
// the tab did not choose: a shared computer's next person read "Keep me logged
// in" ticked in a tab whose saved choice was not to keep.
{
  const fresh = openTab();
  check(fresh.keepChoice() === true, "the sign-in box starts ticked in a tab with no choice yet");
  signIn(fresh, "box-unticked", false);
  check(fresh.keepChoice() === false, "a tab that signed in unticked shows the box unticked");
  signOut(fresh);
  check(fresh.keepChoice() === false, "and still unticked after signing out, for the next person");
  signIn(fresh, "box-ticked", true);
  check(fresh.keepChoice() === true, "ticking it keeps: the box shows ticked");
  check(JSON.parse(browser.localStorage.getItem(KEY)).user === "box-ticked", "and the ticked sign-in is kept");
  const beside = openTab();
  signIn(beside, "box-beside", false);
  check(fresh.keepChoice() === true && beside.keepChoice() === false, "each tab shows its own choice");
  signOut(fresh);
}
// The screens start from that choice rather than a literal true.
for (const file of ["src/app/main.jsx", "src/app/admin/login.jsx"]) {
  const source = readFileSync(file, "utf8");
  check(/useState\(keepChoice\)/.test(source) && !/\[keepSignedIn, setKeepSignedIn\] = useState\(true\)/.test(source),
    `${file} draws the box from this tab's saved choice`);
}

// The company a tab works in belongs to the tab (src/lib/active-org-storage.mjs).
// Recorded Nov 13: a brand tab reloaded into the factory workspace after another
// tab switched company, or after another person's tab reloaded.
{
  const shared = new MemoryStorage();
  const openOrgTab = (orgs) => {
    const win = { localStorage: shared, sessionStorage: new MemoryStorage() };
    const t = { win, orgs, ...createActiveOrgStorage(win) };
    // What AuthProvider does: read on load, fall back if not a member.
    t.load = () => {
      const stored = t.read();
      const org = pickActiveOrg(t.orgs, stored);
      if (org && org.id !== stored) t.fallBack(org.id);
      return org?.id ?? null;
    };
    t.load();
    return t;
  };
  const switcher = [{ id: "brand" }, { id: "factory" }];
  const brandTab = openOrgTab(switcher);
  brandTab.choose("brand");
  const factoryTab = openOrgTab(switcher);
  check(factoryTab.load() === "brand", "a new tab opens on the company last chosen in this browser");
  factoryTab.choose("factory");
  check(brandTab.load() === "brand", "switching company in another tab does not move this tab on reload");
  check(factoryTab.load() === "factory", "and the other tab keeps its own choice on reload");
  const otherPerson = openOrgTab([{ id: "someone-else" }]);
  check(otherPerson.load() === "someone-else", "a company the person is not in is never used, whatever is stored");
  check(brandTab.load() === "brand" && shared.getItem(ACTIVE_ORG_KEY) === "factory",
    "another person's tab falling back changes neither this tab nor the default for new tabs");
  check(openOrgTab(switcher).load() === "factory", "a new tab after that still opens on the last company chosen");
  brandTab.clear();
  check(brandTab.load() === "brand" && factoryTab.load() === "factory",
    "after signing out, a tab is shown only a company from the list it signs in with");
  check(pickActiveOrg([], "brand") === null, "no companies, no workspace");
  const auth = readFileSync("src/lib/auth.jsx", "utf8");
  check(!/localStorage\.(get|set|remove)Item\("tscActiveOrg"/.test(auth), "AuthProvider keeps the company only through the per-tab store");
}

// A review email's link, opened in a new tab while the browser keeps another
// sign-in (Nov 18): the new tab reads the remembered one, so the link screen
// offers "Log in with another account", for that tab only.
{
  const kept = openTab();
  signIn(kept, "kept-plus-2", true);
  const signup = openTab();
  signUp(signup, "new-factory");
  check(signup.shown === "new-factory" && kept.shown === "kept-plus-2", "a sign-up beside a kept sign-in stays in its own tab");
  const link = openTab();
  check(link.shown === "kept-plus-2", "the email's new tab reads the remembered sign-in (the cause)");
  // logInAnotherAccountHere: no sign-out is sent (Supabase revokes even a
  // "local" one on the server), the tab drops the shared sign-in and reloads.
  check(link.leaveSharedSignIn(KEY) === true, "leaving the remembered sign-in is done in this tab");
  check(reload(link) === null, "after the reload this tab is signed out");
  check(JSON.parse(browser.localStorage.getItem(KEY)).user === "kept-plus-2" && reload(kept) === "kept-plus-2",
    "and every other tab keeps the remembered sign-in");
  check(link.keepChoice() === false, "its sign-in box starts unticked, so the next sign-in stays in this tab");
  signIn(link, "new-factory", link.keepChoice());
  check(link.shown === "new-factory" && reload(link) === "new-factory", "signing in there lands on the right account");
  check(reload(kept) === "kept-plus-2" && reload(signup) === "new-factory", "the other two tabs are untouched");
  check(link.leaveSharedSignIn(KEY) === false, "a tab signed in on its own signs out the ordinary way instead");
  signOut(link);
  check(reload(kept) === "kept-plus-2", "and that sign-out leaves the remembered sign-in alone");
  signOut(kept);
  signOut(signup);
}
const linkSource = readFileSync("src/app/main.jsx", "utf8");
check(/logInAnotherAccountHere\(\)/.test(linkSource) && !/Log out and continue/.test(linkSource),
  "the link screen switches this tab only, never a sign-out of every tab");

// The code email's link lands on app.html alone, in a new tab; the review
// link's portal, company and language come back with it, and so does the sign-in
// box's choice (src/lib/return-after-link.mjs).
{
  const local = new MemoryStorage();
  const at = (search, session = new MemoryStorage()) => ({ location: { search }, localStorage: local, sessionStorage: session });
  rememberReturn(at("?portal=factory&review=0200dc8a-a693-4e53-a87e-6b1699cab266&mode=login"), {}, 1000);
  check(restoreReturn(at(""), 2000) === null, "a page that is not a link landing leaves it waiting");
  check(restoreReturn(at("?code=abc"), 2000) === "?code=abc&portal=factory&review=0200dc8a-a693-4e53-a87e-6b1699cab266",
    "the link landing gets back portal and review, nothing else");
  check(restoreReturn(at("?code=abc"), 3000) === null, "used once");
  rememberReturn(at("?review=x"), {}, 0);
  check(restoreReturn(at("?code=abc"), 61 * 60 * 1000) === null, "and only within the hour");
  rememberReturn(at("?portal=factory"), {}, 0);
  check(restoreReturn(at("?code=abc&review=y"), 1) === null, "a link that carries its own parameters keeps them");
  rememberReturn(at(""), {}, 0);
  check(local.getItem("tscReturnAfterLink") === null, "a code asked from a plain page, box ticked, remembers nothing");

  // Box unticked: the new tab the link opens keeps the session to itself, so
  // the browser's remembered sign-in (other tabs) is not replaced.
  const landing = new MemoryStorage();
  rememberReturn(at("?portal=factory&review=r1"), { keepSignedIn: false }, 0);
  restoreReturn(at("?code=abc", landing), 1);
  check(landing.getItem("tscKeepSignedIn") === "0", "asked with the box unticked, the link's tab keeps the sign-in to itself");
  const plain = new MemoryStorage();
  rememberReturn(at(""), { keepSignedIn: false }, 0);
  check(restoreReturn(at("?code=abc", plain), 1) === null && plain.getItem("tscKeepSignedIn") === "0",
    "also from a plain page");
  const ticked = new MemoryStorage();
  rememberReturn(at("?review=r2"), { keepSignedIn: true }, 0);
  restoreReturn(at("?code=abc", ticked), 1);
  check(ticked.getItem("tscKeepSignedIn") === null, "ticked, the link's tab keeps it as before");
}
for (const file of ["src/app/main.jsx", "src/app/admin/login.jsx"]) {
  check(/sendEmailCode\(email, \{ createUser: false, keepSignedIn \}\)/.test(readFileSync(file, "utf8")),
    `${file} sends the box's choice with the code`);
}

// The marketing pages hand a sign-in link's `?code=` to the app (script.js):
// Supabase's fallback lands on the home address, which cannot finish it.
{
  const source = readFileSync("script.js", "utf8");
  const guard = source.slice(0, source.indexOf("})();") + 5);
  const visit = (pathname, search) => {
    let went = null;
    const window = { location: { pathname, search, hash: "", replace: (to) => { went = to; } } };
    new Function("window", "URLSearchParams", guard)(window, URLSearchParams);
    return went;
  };
  const code = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
  check(visit("/", `?code=${code}`) === `/app.html?code=${code}`, "the home page hands a sign-in code to the app");
  check(visit("/factories.html", `?code=${code}&lang=zh`) === `/app.html?code=${code}&lang=zh`, "any marketing page does, with the rest of the query");
  check(visit("/", "?code=not-a-code") === null && visit("/", "?lang=zh") === null && visit("/", "") === null,
    "nothing else is forwarded");
  check(visit("/app.html", `?code=${code}`) === null, "and the app itself is never forwarded (no loop)");
}

if (failures) {
  console.error(`\n${failures} check(s) failed: "Keep me logged in" does not hold across tabs.`);
  process.exit(1);
}
console.log("\nKeep me logged in holds across tabs.");
