/**
 * Authentication — passwordless.
 *
 * Primary method is a one-time code emailed to the user. Google is supported
 * too, but only lights up once OAuth credentials exist, so the app is never
 * blocked on an external provider being configured.
 *
 * Neither path involves a password. Nothing here calls signInWithPassword and
 * no account ever has one set.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "./supabase.js";
import { listMyOrgs } from "./domain/org.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
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

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session ?? null);
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
  }, [session?.user?.id]);

  // Keep the remembered org valid: drop it if the user lost access.
  useEffect(() => {
    if (!orgs.length) return;
    const stillAMember = orgs.some((org) => org.id === activeOrgId);
    if (!stillAMember) {
      setActiveOrgId(orgs[0].id);
      window.localStorage.setItem("tscActiveOrg", orgs[0].id);
    }
  }, [orgs, activeOrgId]);

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

      /** True once a Google OAuth client has been configured for the project. */
      googleEnabled: Boolean(import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true"),

      /**
       * Email a one-time code. The same email also carries a magic link, so
       * whichever is easier works — the code matters most on a preview deploy
       * behind SSO, where following the link lands somewhere useless.
       */
      async sendEmailCode(email) {
        setError(null);
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            shouldCreateUser: true,
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
        const { error: signInError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            queryParams: { prompt: "select_account" },
          },
        });
        if (signInError) setError(signInError);
      },

      async signOut() {
        await supabase.auth.signOut();
        window.localStorage.removeItem("tscActiveOrg");
        setOrgs([]);
        setActiveOrgId(null);
      },

      async refreshOrgs() {
        const rows = await listMyOrgs();
        setOrgs(rows);
        setStatus(rows.length ? "ready" : "no-org");
        return rows;
      },
    };
  }, [status, error, session, orgs, activeOrgId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
