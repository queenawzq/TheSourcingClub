/**
 * A very small router.
 *
 * Phase 2 adds a dozen screens and needs shareable links — "here is the
 * request" has to survive being pasted into a message. The app previously
 * switched on component state, which cannot do that.
 *
 * Hand-rolled rather than pulling in react-router: the whole need is one
 * path, a few params, and a back button. React 19 needs no help with the rest.
 *
 * Paths are rooted at /app.html, so `/rfqs/:id` is really
 * `/app.html/rfqs/:id`. A `vercel.json` rewrite maps `/app.html/*` back to the
 * page, because `cleanUrls` is off and Vite treats app.html as its own entry —
 * without it a hard refresh on a deep link 404s.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const BASE = "/app.html";
const RouterContext = createContext(null);

function currentPath() {
  const path = window.location.pathname;
  if (path.startsWith(BASE)) return path.slice(BASE.length) || "/";
  // Served from a rewrite or a dev server that dropped the suffix.
  return path === "/" ? "/" : path;
}

export function RouterProvider({ children }) {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const next = to.startsWith("/") ? to : `/${to}`;
    const url = `${BASE}${next === "/" ? "" : next}`;
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setPath(next);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used inside a RouterProvider");
  return context;
}

/**
 * Match a pattern like "/rfqs/:id/quotes" against the current path.
 * Returns the params object, or null when it does not match.
 */
export function matchPath(pattern, path) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

/**
 * Pick the first matching route.
 *
 * `routes` is an array of { path, render(params) }, checked in order, so put
 * specific paths before their wildcards. A trailing `{ render }` with no path
 * is the fallback.
 */
export function useRoute(routes) {
  const { path } = useRouter();

  for (const route of routes) {
    if (!route.path) return route.render({});
    const params = matchPath(route.path, path);
    if (params) return route.render(params);
  }
  return null;
}

/** An anchor that navigates without a full page load. */
export function Link({ to, children, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={`${BASE}${to}`}
      onClick={(event) => {
        // Let the browser handle modified clicks — open in new tab still works.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
