/**
 * Authentication — email and password, as the designed screen asks for.
 *
 * src/shared/AuthScreen.jsx is the specification: a work email, a password of
 * at least eight characters, "keep me logged in", "forgot password", and
 * Google alongside. This module makes the backend answer that screen rather
 * than the other way round.
 *
 * Signing up is one step, not two. The design collects the person's name and
 * their company's name on the same form, and which portal they are standing
 * in says whether that company is a brand or a vendor — so an account, a
 * profile name and an organisation are all created together. There is no
 * separate "which side are you on?" question afterwards, because the screen
 * already knows.
 *
 * A one-time code is still emailed, but only for recovery: "forgot password"
 * sends a reset link, and that link is how someone locked out gets back in.
 * It is not a way to sign in without a password.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isConfigured, sentTwice, setKeepSignedIn, keepNewAccount, isThisTabsSession } from "./supabase.js";
import { createOrg, listMyInvitations, listMyOrgs } from "./domain/org.js";
import { closeCallWindowsForSignOut } from "../app/message/call-window.js";
import { logoutStripeConnect } from "./stripe-connect-embed.js";
import { authFailure, isNoAnswer } from "../shared/auth-messages.mjs";
import { takeRecoveryToken } from "./recovery-link.mjs";

/** Mirrors `minimum_password_length` in supabase/config.toml and the design's copy. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * How long a sign-up or log-in waits before saying something. A blocked route
 * drops traffic rather than refusing it, and the button then sat on "Creating
 * your account…" with no words and no way out. Long enough for a slow route
 * from China. It stops the wait, not the request: an answer that comes later
 * still signs them in.
 */
const AUTH_WAIT_MS = 30000;
const TIMED_OUT = "timed out";

function answerInTime(request) {
  let timer;
  const expired = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve({ data: null, error: new Error(TIMED_OUT) }), AUTH_WAIT_MS);
  });
  return Promise.race([request, expired]).finally(() => window.clearTimeout(timer));
}

/**
 * Tell our own host that the database's did not answer. Those failures reach
 * nothing else we own, so without this nobody could count them. Goes without
 * waiting, carries no address, and never affects the screen.
 */
function reportNoAnswer(stage, authError, portal) {
  const kind = authError?.message === TIMED_OUT ? "timeout" : isNoAnswer(authError) ? "network" : null;
  if (!kind) return;
  try {
    navigator.sendBeacon?.("/api/auth-failure", new Blob([JSON.stringify({
      stage,
      kind,
      portal: portal ?? (new URLSearchParams(window.location.search).get("portal") ? "factory" : "brand"),
      language: navigator.language,
    })], { type: "application/json" }));
  } catch {
    // Never surfaces.
  }
}

const alreadyRegistered = (authError) =>
  authError?.code === "user_already_exists" || /already registered/i.test(authError?.message ?? "");

/**
 * Supabase speaks in codes; a person locked out of their account needs a
 * sentence. Anything unrecognised falls through to the original message
 * rather than being flattened into "something went wrong" — an unhelpful
 * message that is accurate beats a friendly one that is not.
 */
function readable(authError) {
  if (!authError) return null;
  const code = authError.code ?? "";
  const message = authError.message ?? "";

  if (message === TIMED_OUT) return authFailure("timeout");
  if (isNoAnswer(authError)) return authFailure("network");

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return authFailure("invalid_credentials");
  }
  if (alreadyRegistered(authError)) {
    return authFailure("account_exists");
  }
  if (code === "weak_password" || /password should be at least/i.test(message)) {
    return authFailure("short_password", { min: MIN_PASSWORD_LENGTH });
  }
  if (code === "email_not_confirmed") {
    return authFailure("email_not_confirmed");
  }
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return authFailure("rate_limited");
  }
  return authError instanceof Error ? authError : new Error(message);
}

const AuthContext = createContext(null);
const SESSION_RESTORE_TIMEOUT_MS = 4000;
const ORG_LOAD_TIMEOUT_MS = 8000;

/**
 * Every sign-in says where its session goes. A path that forgets would
 * silently keep the session for the whole browser, which is the bug the demo
 * buttons had; this makes the omission loud instead.
 */
function requireKeepChoice(keepSignedIn) {
  if (typeof keepSignedIn !== "boolean") {
    throw new TypeError("a sign-in must say whether to keep the session (keepSignedIn)");
  }
}

/**
 * A session ended from outside this tab (another tab signed out, or the auth
 * server dropped it): the sign-in screen reads the portal from the address, and
 * only this tab's own Log out wrote it there, so a vendor landed on the brand's
 * login. What it was working in is still known at this moment. Nothing to do
 * after this tab's own Log out, which has already emptied the list.
 */
function keepPortalInAddress(orgs, activeOrgId) {
  const org = orgs.find((row) => row.id === activeOrgId) ?? orgs[0];
  if (!org) return;
  const url = new URL(window.location.href);
  if (org.type === "factory") url.searchParams.set("portal", "factory");
  else url.searchParams.delete("portal");
  window.history.replaceState(window.history.state, "", url);
}

export function AuthProvider({ children }) {
  // `undefined` means Supabase has not finished restoring the browser session
  // yet; `null` means that restoration finished and there is no signed-in
  // user. Keeping those states separate prevents protected pages from briefly
  // redirecting to sign-in before an existing session has been recovered.
  const [session, setSession] = useState(undefined);
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(
    () => window.localStorage.getItem("tscActiveOrg") || null,
  );
  const [status, setStatus] = useState(isConfigured ? "loading" : "unconfigured");
  const [error, setError] = useState(null);
  // A signup creates its company after the session exists, so for a moment
  // the new user has none. Without this the shell drew the "Which side are
  // you on?" card in that moment, for a question the signup form had already
  // answered.
  const [creatingOrg, setCreatingOrg] = useState(false);
  // Each membership lookup takes a number; only the latest one may set the
  // status. The lookup the new session starts can finish after the signup's
  // own reload, and its "no company yet" then overwrote the company that had
  // just been created, leaving the card up for good.
  const orgLoadSeq = useRef(0);
  // The address a sign-up got no answer for. The account may exist all the
  // same: the request can arrive and only the reply be lost.
  const unansweredSignUp = useRef(null);

  // Restore an existing session, then follow every change.
  useEffect(() => {
    if (!isConfigured) return undefined;

    let cancelled = false;
    let restored = false;

    const finishRestore = (nextSession) => {
      if (cancelled) return;
      restored = true;
      window.clearTimeout(restoreTimeout);
      setSession(nextSession ?? null);
    };

    // A stale refresh token or a browser lock held by another tab can leave
    // Supabase's initial getSession() pending indefinitely. Authentication may
    // still recover through onAuthStateChange, but the public login/signup
    // screen must not be hidden behind a permanent spinner in the meantime.
    const restoreTimeout = window.setTimeout(() => {
      if (cancelled || restored) return;
      restored = true;
      setSession(null);
    }, SESSION_RESTORE_TIMEOUT_MS);

    // A password-reset link carries its token in the fragment and lands here
    // (src/lib/recovery-link.mjs). Verifying it is a fetch, so it goes direct
    // or through our own host like everything else; the restore waits for it,
    // since a slow route can take longer than the usual restore allows.
    const recoveryToken = takeRecoveryToken(window);
    const recovered = recoveryToken === null
      ? Promise.resolve()
      : (window.clearTimeout(restoreTimeout), answerInTime(
        supabase.auth.verifyOtp({ token_hash: recoveryToken, type: "recovery" }),
      ).then(({ error: verifyError }) => {
        if (!verifyError || cancelled) return;
        const unreachable = verifyError.message === TIMED_OUT || isNoAnswer(verifyError);
        if (unreachable) reportNoAnswer("reset", verifyError);
        setError(authFailure(unreachable ? "reset_link_network" : "reset_link_used"));
      }, () => {
        if (!cancelled) setError(authFailure("reset_link_network"));
      }));

    recovered.then(() => supabase.auth.getSession()).then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        if (restored) return;
        restored = true;
        window.clearTimeout(restoreTimeout);
        setError(readable(sessionError));
        setStatus("error");
        return;
      }
      finishRestore(data.session);
    }).catch((sessionError) => {
      if (cancelled || restored) return;
      restored = true;
      window.clearTimeout(restoreTimeout);
      setError(readable(sessionError));
      setStatus("error");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // supabase-js tells every tab on the site about every sign-in, sign-out
      // and refresh. A tab signed in without "Keep me logged in" holds its
      // own session, and must not turn into whoever signed in next door.
      if (!isThisTabsSession(nextSession)) return;
      // Signed out, here or next door: this tab now holds nobody, and stays
      // that way until it signs in itself. Left on the shared store, whoever
      // signs up in another tab next became this tab too, with its old screen
      // still drawn and its answers saved on the new company (Nov 8).
      if (event === "SIGNED_OUT") setKeepSignedIn(false);
      if (!nextSession) {
        closeCallWindowsForSignOut();
        keepPortalInAddress(orgsRef.current, activeOrgIdRef.current);
      }
      finishRestore(nextSession);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // Load memberships whenever the signed-in user changes.
  useEffect(() => {
    if (!isConfigured) return;

    if (session === undefined) {
      setStatus("loading");
      return;
    }

    if (!session) {
      setOrgs([]);
      setStatus("signed-out");
      return;
    }

    let cancelled = false;
    let loadFinished = false;
    const seq = ++orgLoadSeq.current;
    setStatus("loading");

    const loadTimeout = window.setTimeout(() => {
      if (cancelled || loadFinished) return;
      // Treat a session whose membership lookup cannot finish as recoverable.
      // The public auth screen is useful; an infinite loading gate is not.
      loadFinished = true;
      setOrgs([]);
      setSession(null);
      setError(null);
      setStatus("signed-out");
    }, ORG_LOAD_TIMEOUT_MS);

    listMyOrgs(session.user.id)
      .then((rows) => {
        if (cancelled || loadFinished) return;
        loadFinished = true;
        window.clearTimeout(loadTimeout);
        if (seq !== orgLoadSeq.current) return;
        setOrgs(rows);
        setStatus(rows.length ? "ready" : "no-org");
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled || loadFinished) return;
        loadFinished = true;
        window.clearTimeout(loadTimeout);
        setError(loadError);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimeout);
    };
    // `session === undefined` has to be its own dependency. Keying only on the
    // user id meant the restore finishing for a SIGNED-OUT visitor moved
    // session from undefined to null while `session?.user?.id` stayed
    // undefined — an unchanged dependency, so React never re-ran this effect
    // and the status never left "loading". Every signed-out visitor sat on
    // "Checking your session…" forever. A signed-in one was fine, because
    // their id did change, which is why it survived a quick look.
  }, [session === undefined, session?.user?.id]);

  // Keep the remembered org valid: drop it if the user lost access.
  useEffect(() => {
    if (!orgs.length) return;
    const stillAMember = orgs.some((org) => org.id === activeOrgId);
    if (!stillAMember) {
      setActiveOrgId(orgs[0].id);
      window.localStorage.setItem("tscActiveOrg", orgs[0].id);
    }
  }, [orgs, activeOrgId]);

  const reloadOrgs = useCallback(async () => {
    const seq = ++orgLoadSeq.current;
    const rows = await listMyOrgs(session?.user?.id);
    if (seq !== orgLoadSeq.current) return rows;
    setOrgs(rows);
    setStatus(rows.length ? "ready" : "no-org");
    return rows;
  }, [session?.user?.id]);

  // The company this person was just removed from, said once on screen.
  const [lostAccess, setLostAccess] = useState(null);
  const orgsRef = useRef(orgs);
  orgsRef.current = orgs;
  const activeOrgIdRef = useRef(activeOrgId);
  activeOrgIdRef.current = activeOrgId;

  // A permission changed, or this person was removed, while the app is open:
  // the database already refuses them, and the screen follows. Realtime
  // carries only this person's own membership rows (and a removal's key).
  useEffect(() => {
    const userId = session?.user?.id;
    if (!isConfigured || !userId) return undefined;
    let timer = null;
    const channel = supabase
      .channel(`org_members:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "org_members", filter: `user_id=eq.${userId}` }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(async () => {
          const before = orgsRef.current;
          const rows = await reloadOrgs().catch(() => null);
          if (!rows) return;
          const gone = before.find((org) => !rows.some((row) => row.id === org.id));
          if (gone) setLostAccess(gone.name);
        }, 300);
      })
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, reloadOrgs]);

  const value = useMemo(() => {
    const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0] ?? null;

    return {
      status: creatingOrg && status === "no-org" ? "loading" : status,
      error,
      session,
      user: session?.user ?? null,
      orgs,
      activeOrg,
      lostAccess,
      dismissLostAccess: () => setLostAccess(null),

      // `remember: false` is for a link that says which company it is about:
      // this page opens on it, and the next visit opens where the person left off.
      selectOrg(orgId, { remember = true } = {}) {
        setActiveOrgId(orgId);
        if (remember) window.localStorage.setItem("tscActiveOrg", orgId);
      },

      /**
       * True once a Google OAuth client has been configured for the project.
       *
       * The design shows the button unconditionally. It stays hidden until
       * credentials exist, because a button that opens Google and comes back
       * with an error is worse than one that is not there — the person has no
       * way to tell whether they did something wrong.
       */
      googleEnabled: Boolean(import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true"),

      minPasswordLength: MIN_PASSWORD_LENGTH,

      /**
       * Create an account, a profile and an organisation in one submit.
       *
       * `accountType` comes from the portal the form was rendered in, which is
       * what the design's two entry points mean. The org is created after the
       * session exists, because create_org() makes the caller its owner and
       * there is deliberately no INSERT policy on orgs for it to use instead.
       *
       * If the account is created but the org is not — a name collision, a
       * dropped connection — the user is signed in with no org and the shell
       * asks for a company name. That is a recoverable state on purpose:
       * failing the whole signup would leave an account they cannot sign into
       * twice, because the address is already taken.
       */
      async signUpWithPassword({ email, password, fullName, companyName, accountType }) {
        setError(null);

        if (password.length < MIN_PASSWORD_LENGTH) {
          setError(authFailure("short_password", { min: MIN_PASSWORD_LENGTH }));
          return false;
        }

        // The signup screen offers no "keep me logged in": a new account stays
        // signed in, in this browser, unless another tab keeps its own there.
        keepNewAccount();
        const address = email.trim().toLowerCase();
        const answered = await answerInTime(supabase.auth.signUp({
          email: address,
          password,
          options: {
            data: {
              full_name: fullName?.trim() || null,
              company_name: companyName?.trim() || null,
              account_type: accountType === "factory" ? "factory" : "brand",
            },
            emailRedirectTo: window.location.origin + window.location.pathname,
          },
        }));
        let data = answered.data;
        let signUpError = answered.error;

        // The same address again after a sign-up nobody answered: "already
        // exists" most likely means that first try got through, so the person
        // is logged in rather than told off for pressing the button twice.
        // Wrong password: the usual sentence. The card stays away meanwhile,
        // because the company below uses what they typed this time.
        const cameBack = alreadyRegistered(signUpError) && (sentTwice("/auth/v1/signup") || unansweredSignUp.current === address);
        if (cameBack) {
          setCreatingOrg(true);
          const loggedIn = await answerInTime(supabase.auth.signInWithPassword({ email: address, password }));
          if (loggedIn.error) {
            setCreatingOrg(false);
          } else {
            data = loggedIn.data;
            signUpError = null;
          }
        }

        if (signUpError) {
          reportNoAnswer("signup", signUpError, accountType);
          const failure = readable(signUpError);
          if (failure.kind === "network" || failure.kind === "timeout") unansweredSignUp.current = address;
          setError(failure);
          return false;
        }
        unansweredSignUp.current = null;

        // With confirmations off this is already a live session. With them on
        // it is not, and there is nothing to create an org with yet.
        if (!data.session) {
          setError(authFailure("confirm_to_continue"));
          return false;
        }

        // Someone signing up from a teammate's invitation joins that company;
        // creating one of their own as well is the one thing they should not
        // do. The shell's "You have been invited" card asks them instead.
        // A failed read is "don't know", not "not invited": ChooseOrgType asks.
        const invited = await listMyInvitations().catch(() => null);
        // Coming back, they may already have one: an answer can arrive late.
        const alreadyHasOne = cameBack && (await listMyOrgs(data.session.user.id).catch(() => [])).length > 0;
        if (companyName?.trim() && invited && !invited.length && !alreadyHasOne) {
          setCreatingOrg(true);
          try {
            await createOrg(companyName.trim(), accountType === "factory" ? "factory" : "brand");
            await reloadOrgs();
          } catch (orgError) {
            reportNoAnswer("company", orgError, accountType);
            setError(isNoAnswer(orgError) ? authFailure("company_network") : orgError);
          } finally {
            setCreatingOrg(false);
          }
        } else if (cameBack) {
          setCreatingOrg(false);
        }
        return true;
      },

      /**
       * The design's login form, and the test sites' demo buttons.
       *
       * `keepSignedIn` is required: it is what the screen's "Keep me logged
       * in" box says. It once defaulted to true, and the demo buttons, which
       * never passed it, kept every session for the whole browser whatever
       * the box said.
       */
      async signInWithPassword({ email, password, keepSignedIn }) {
        requireKeepChoice(keepSignedIn);
        setError(null);
        setKeepSignedIn(keepSignedIn);

        const { error: signInError } = await answerInTime(supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        }));
        if (signInError) {
          reportNoAnswer("login", signInError);
          setError(readable(signInError));
          return false;
        }
        return true;
      },

      /**
       * "Forgot password?".
       *
       * Reports whether the address actually has an account, so someone who
       * mistyped theirs is told rather than left waiting for an email that is
       * never coming. John's call on 2026-09-20, knowing what it costs: this
       * is what lets anyone ask whether a company is a customer, one address
       * at a time. /api/account-exists rate-limits per client for that reason.
       *
       * The reset itself is always requested, and its result inspected only for
       * "it never got there" — the lookup decides what we SAY, not what we do.
       * So a lookup that is
       * unconfigured, rate-limited or simply down degrades to the old neutral
       * message instead of breaking the reset.
       */
      async requestPasswordReset(email) {
        setError(null);
        const address = email.trim().toLowerCase();

        const { error: resetError } = await answerInTime(supabase.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}${window.location.pathname}?reset=1`,
        }));
        // The one result that is looked at: "on its way" would be untrue.
        if (resetError && (resetError.message === TIMED_OUT || isNoAnswer(resetError))) {
          reportNoAnswer("reset", resetError);
          setError(authFailure("reset_network"));
          return { sent: false, exists: null };
        }

        try {
          const response = await fetch("/api/account-exists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: address }),
          });
          if (!response.ok) return { sent: true, exists: null };
          const { exists } = await response.json();
          return { sent: true, exists: typeof exists === "boolean" ? exists : null };
        } catch {
          return { sent: true, exists: null };
        }
      },

      /** Set a new password, on the session the reset link established. */
      async updatePassword(password) {
        setError(null);
        if (password.length < MIN_PASSWORD_LENGTH) {
          setError(authFailure("short_password", { min: MIN_PASSWORD_LENGTH }));
          return false;
        }
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) {
          setError(readable(updateError));
          return false;
        }
        return true;
      },

      /**
       * Email a one-time code. The same email also carries a magic link, so
       * whichever is easier works — the code matters most on a preview deploy
       * behind SSO, where following the link lands somewhere useless.
       */
      async sendEmailCode(email, { createUser = false } = {}) {
        setError(null);
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            // Defaults to false. Called from a SIGN-IN screen, creating a user
            // for whatever address was typed would mint an org-less account
            // and bypass the one-step signup the design specifies.
            shouldCreateUser: createUser,
            emailRedirectTo: window.location.origin + window.location.pathname,
          },
        });
        if (otpError) {
          reportNoAnswer("code", otpError);
          setError(readable(otpError));
          return false;
        }
        return true;
      },

      /** Exchange the emailed code for a session, kept as the login form's box says. */
      async verifyEmailCode(email, token, { keepSignedIn } = {}) {
        requireKeepChoice(keepSignedIn);
        setError(null);
        setKeepSignedIn(keepSignedIn);
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: token.trim(),
          type: "email",
        });
        if (verifyError) {
          reportNoAnswer("code", verifyError);
          setError(readable(verifyError));
          return false;
        }
        return true;
      },

      async signInWithGoogle() {
        setError(null);
        setKeepSignedIn(true);
        const { error: signInError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            queryParams: { prompt: "select_account" },
          },
        });
        if (signInError) setError(signInError);
      },

      clearError() {
        setError(null);
      },

      async signOut() {
        // Set the status here rather than waiting for the auth listener to
        // fire. Clearing orgs while the status is still "ready" leaves the
        // shell rendering with no active org, which crashes it to a blank
        // page — the state this ordering exists to prevent.
        setStatus("signed-out");
        setOrgs([]);
        setActiveOrgId(null);
        window.localStorage.removeItem("tscActiveOrg");
        closeCallWindowsForSignOut();
        logoutStripeConnect();
        // supabase-js owns the stored token, and nothing else may clear it.
        //
        // Deleting the keys here first looked like it closed a gap — the login
        // screen renders before this await resolves — but the client still
        // holds the session in memory with a refresh timer running. Pulled out
        // from under it, the refresh either wrote the session straight back
        // (sign-out silently reversed itself) or left getUser() never
        // settling, which parked the whole app on "Checking your session…"
        // with no error and no way forward. signOut() cancels that timer and
        // clears the storage itself; letting it do both is the fix.
        await supabase.auth.signOut();
      },

      refreshOrgs: reloadOrgs,
    };
  }, [status, creatingOrg, error, session, orgs, activeOrgId, reloadOrgs, lostAccess]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
