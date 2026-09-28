/**
 * The vendor's saved requests, on Queena's designed Saved page.
 *
 * "Save request" on the RFQ detail screen had nowhere to put anything and the
 * Saved nav item went nowhere. Both ends exist now: saved_rfqs holds the list,
 * and this is the page that reads it back.
 *
 * The design's other tab, saved brands, has no storage behind it, so a live
 * mount shows only the requests.
 */
import React, { useEffect, useState } from "react";
import { FactorySavedPage } from "../../factory-prototype/main.jsx";
import { listSavedRequests } from "../../lib/domain/rfq.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export default function LiveSaved({ org }) {
  const { navigate } = useRouter();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listSavedRequests(org.id)
      .then((saved) => !cancelled && setRows(saved ?? []))
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  if (error) return <p className="composer-error" role="alert">{error.message}</p>;
  if (!rows) return null;

  const saved = rows
    .filter((row) => row.rfqs)
    .map((row) => {
      const rfq = row.rfqs;
      return {
        id: rfq.id,
        title: rfq.title || "Request",
        brand: rfq.orgs?.name ?? "",
        initials: (rfq.orgs?.name ?? "??").slice(0, 2).toUpperCase(),
        location: "",
        budget: formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents),
        quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
        samples: rfq.requires_sample ? "Sample required" : "No sample",
        quoteDue: rfq.quote_deadline ? DAY.format(new Date(rfq.quote_deadline)) : "",
        specialty: rfq.brief ?? "",
        posted: rfq.published_at ? `Posted ${DAY.format(new Date(rfq.published_at))}` : "",
        // Nothing behind these on a saved card, so they stay empty rather
        // than borrowing the design's examples.
        trust: "",
        tags: [],
        capacity: [],
        images: [],
        fitTone: "",
      };
    });

  return (
    <FactorySavedPage
      language="en"
      rfqs={saved}
      onViewRfq={(project) => navigate(project?.id ? `/browse/${project.id}` : "/browse")}
      onViewBrand={() => navigate("/browse")}
    />
  );
}
