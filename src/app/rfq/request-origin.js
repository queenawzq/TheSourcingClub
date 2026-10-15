const REQUEST_ORIGINS = {
  browse: { path: "/browse", label: "Browse RFQs" },
  rfqs: { path: "/rfqs", label: "RFQs" },
  saved: { path: "/saved", label: "Saved" },
  dashboard: { path: "/", label: "Dashboard" },
};

export function getRequestOrigin() {
  const requested = new URLSearchParams(window.location.search).get("from");
  return REQUEST_ORIGINS[requested] ? requested : "browse";
}

export function getRequestBackTarget(origin = getRequestOrigin()) {
  return REQUEST_ORIGINS[origin] ?? REQUEST_ORIGINS.browse;
}

export function withRequestOrigin(path, origin = getRequestOrigin()) {
  return `${path}?from=${encodeURIComponent(origin)}`;
}
