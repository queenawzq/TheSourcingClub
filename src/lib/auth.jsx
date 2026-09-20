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
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase, isConfigured, setKeepSignedIn } from "./supabase.js";
import { createOrg, listMyOrgs } from "./domain/org.js";

/** Mirrors `minimum_password_length` in supabase/config.toml and the design's copy. */
export const MIN_PASSWORD_LENGTH = 8;

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

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return new Error("That email and password do not match an account.");
  }
  if (code === "user_already_exists" || /already registered/i.test(message)) {
    return new Error("An account already exists for that email. Log in instead.");
  }
  if (code === "weak_password" || /password should be at least/i.test(message)) {
    return new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (code === "email_not_confirmed") {
    return new Error("Confirm your email address first — check your inbox.");
  }
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return new Error("Too many attempts just now. Wait a minute and try again.");
  }
  return authError instanceof Error ? authError : new Error(message);
}

const AuthContext = createContext(null);

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

  // Restore an existing session, then follow every change.
  useEffect(() => {
    if (!isConfigured) return undefined;

    let cancelled = false;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) {
        setError(readable(sessionError));
        setStatus("error");
        return;
      }
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
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
    setStatus("loading");

    listMyOrgs()
      .then((rows) => {
        if (cancelled) return;
        setOrgs(rows);
        setStatus(rows.length ? "ready" : "no-org");
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError);
        setStatus("error");
      });

    return () => {
      cancelled = true;
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
    const rows = await listMyOrgs();
    setOrgs(rows);
    setStatus(rows.length ? "ready" : "no-org");
    return rows;
  }, []);

  const value = useMemo(() => {
    const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0] ?? null;

    return {
      status,
      error,
      session,
      user: session?.user ?? null,
      orgs,
      activeOrg,

      selectOrg(orgId) {
        setActiveOrgId(orgId);
        window.localStorage.setItem("tscActiveOrg", orgId);
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
          setError(new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`));
          return false;
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { full_name: fullName?.trim() || null, company_name: companyName?.trim() || null },
            emailRedirectTo: window.location.origin + window.location.pathname,
          },
        });
        if (signUpError) {
          setError(readable(signUpError));
          return false;
        }

        // With confirmations off this is already a live session. With them on
        // it is not, and there is nothing to create an org with yet.
        if (!data.session) {
          setError(new Error("Check your email to confirm your address, then log in."));
          return false;
        }

        if (companyName?.trim()) {
          try {
            await createOrg(companyName.trim(), accountType === "factory" ? "factory" : "brand");
            await reloadOrgs();
          } catch (orgError) {
            setError(orgError);
          }
        }
        return true;
      },

      /** The design's login form. */
      async signInWithPassword({ email, password, keepSignedIn = true }) {
        setError(null);
        setKeepSignedIn(keepSignedIn);

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (signInError) {
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
       * The reset itself is always requested and its result never inspected —
       * the lookup decides what we SAY, not what we do. So a lookup that is
       * unconfigured, rate-limited or simply down degrades to the old neutral
       * message instead of breaking the reset.
       */
      async requestPasswordReset(email) {
        setError(null);
        const address = email.trim().toLowerCase();

        await supabase.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}${window.location.pathname}?reset=1`,
        });

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
          setError(new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`));
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
          setError(otpError);
          return false;
        }
        return true;
      },

      /** Exchange the emailed code for a session. */
      async verifyEmailCode(email, token) {
        setError(null);
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: token.trim(),
          type: "email",
        });
        if (verifyError) {
          setError(verifyError);
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
  }, [status, error, session, orgs, activeOrgId, reloadOrgs]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
