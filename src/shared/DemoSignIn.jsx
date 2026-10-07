import React from "react";
import { supabaseUrl } from "../lib/supabase.js";
import { DEMO_LOGINS, DEMO_PASSWORD } from "./demo-logins.mjs";
import "./demo-sign-in.css";

/**
 * "Sign in as a demo account", for test sites only.
 *
 * The logins are the fixed ones scripts/seed-demo.mjs creates, from the list
 * both read (demo-logins.mjs). This file is only ever loaded through
 * `lazy(() => import(...))` behind __DEMO_SIGN_IN__ (see vite.config.js), so
 * a production build does not contain it at all.
 *
 * As a second lock it renders nothing when the build is connected to the
 * production database: a preview missing its test-database variables falls
 * back to production's, and none of these accounts may exist there.
 */
const PRODUCTION_REF = "wxzliajdtwekqdvwzqfb";

const LOGINS = Object.entries(DEMO_LOGINS).map(([key, login]) => ({ key, ...login, password: DEMO_PASSWORD }));

/**
 * `only` limits the buttons to some of the logins (the staff page shows the
 * admin alone). `onPick(login)` signs in with `login.email` and
 * `login.password`; the screen around it owns the busy state and the error.
 */
export default function DemoSignIn({ only, busy = false, onPick, children }) {
  if (!supabaseUrl || supabaseUrl.includes(PRODUCTION_REF)) return null;
  const logins = only ? LOGINS.filter((login) => only.includes(login.key)) : LOGINS;

  return (
    <aside className="demo-sign-in" aria-label="Demo accounts">
      <p className="demo-sign-in-title">
        <strong>Test site only</strong> Sign in as a demo account
      </p>
      <div className="demo-sign-in-list">
        {logins.map((login) => (
          <button key={login.key} type="button" disabled={busy} onClick={() => onPick(login)}>
            <strong>{login.role} <em>{login.name}</em></strong>
            <span>{login.email}</span>
          </button>
        ))}
      </div>
      <p className="demo-sign-in-note">
        Password for all of them: <code>{DEMO_PASSWORD}</code>
      </p>
      {children && <p className="demo-sign-in-note">{children}</p>}
    </aside>
  );
}
