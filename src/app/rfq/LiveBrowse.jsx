/**
 * The factory's view of the marketplace, on Queena's designed screen.
 *
 * `FactoryBrowsePage` comes from src/factory-prototype/main.jsx. This file is
 * the seam.
 *
 * What a factory can see here is decided by RLS, not by this query: an
 * open-to-all request reaches every factory, an invite-only one only the
 * factories with an invitation row. Visibility and the right to quote are
 * separate — an unverified factory sees the marketplace and is refused at the
 * quote, which is what makes verification the thing that unlocks earning
 * rather than the thing that unlocks looking.
 */
import React, { useEffect, useState } from "react";
import { FactoryBrowsePage } from "../../factory-prototype/main.jsx";
import { listOpenRfqs } from "../../lib/domain/rfq.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

/** "18 minutes ago", from when it was published. */
function posted(value) {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `Posted ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Posted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Posted ${Math.round(hours / 24)} days ago`;
}

export default function LiveBrowse({ profile }) {
  // Visibility and the right to quote are separate, and the designs express
  // only the first. A factory that can see the marketplace but cannot yet bid
  // has to be told which it is — finding out at the quote button is finding
  // out too late.

  const { navigate } = useRouter();
  const [rfqs, setRfqs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listOpenRfqs().then(setRfqs).catch(setError);
  }, []);

  if (!rfqs) return null;

  const projects = rfqs.map((rfq) => ({
    id: rfq.id,
    initials: initialsOf(rfq.orgs?.name),
    title: rfq.title || "Untitled request",
    brand: rfq.orgs?.name ?? "A brand",
    location: "",
    posted: posted(rfq.published_at ?? rfq.created_at),
    // Match is a per-pair score this list never asks for, so it is left out
    // rather than filled with a number that came from nowhere.
    match: "",
    quoteDue: rfq.quote_deadline ? new Date(rfq.quote_deadline).toLocaleDateString("en", { month: "short", day: "numeric" }) : "",
    budget: formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency),
    quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
    samples: rfq.requires_sample ? "Sample required" : "No sample",
    specialty: rfq.brief ?? rfq.material_notes ?? "",
    tags: [],
    capacity: [],
    images: [],
    fitTone: "",
    trust: "",
    insight: [],
  }));

  return (
    <>
      {error && <p className="composer-error" role="alert">{error.message}</p>}
      {profile?.verification_status !== "verified" && (
        <div className="browse-gate">
          <strong>You can look, but not bid yet.</strong>
          <span>
            Your business registration is with our review team. Quoting opens as soon as it
            is approved — everything else works while you wait.
          </span>
        </div>
      )}
      <FactoryBrowsePage
        companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
        language="en"
        projects={projects}
        onViewDetails={(project) => navigate(`/browse/${project.id}`)}
      />
    </>
  );
}
