/**
 * The vendor's saved brands and saved requests, on Queena's designed Saved
 * page.
 *
 * "Save request" on the RFQ detail screen fills saved_rfqs, and "Save brand"
 * on a brand's profile fills saved_brands; this is the page that reads both
 * back. A brand card opens the brand's profile (/brands/:id).
 */
import React, { useEffect, useState } from "react";
import { FactorySavedPage } from "../../factory-prototype/main.jsx";
import { listSavedRequests } from "../../lib/domain/rfq.js";
import { listThreads } from "../../lib/domain/message.js";
import { savedBrandCard } from "../profile/brand-profile-view.js";
import { loadSavedBrands } from "../profile/load-profile.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "../profile/profile.css";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export default function LiveSaved({ org }) {
  const { navigate } = useRouter();
  const [rows, setRows] = useState(null);
  const [brands, setBrands] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSavedRequests(org.id), loadSavedBrands(org), listThreads(org.id)])
      .then(([saved, savedBrands, threads]) => {
        if (cancelled) return;
        setRows(saved ?? []);
        setBrands(savedBrands.brands.map((brand) => {
          // The latest conversation with the brand, as on its profile.
          const thread = threads.find((item) => item.brand_org_id === brand.orgId && item.factory_org_id === org.id);
          return {
            ...savedBrandCard(brand, savedBrands.terms),
            contact: thread ? { label: "Contact brand", onClick: () => navigate(`/messages/${thread.id}`) } : null,
          };
        }));
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  if (error) return <p className="composer-error" role="alert">{error.message}</p>;
  if (!rows || !brands) return null;

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
      brands={brands}
      // Saved brands first, as the design; a vendor with none opens on its requests.
      initialTab={brands.length || !saved.length ? "brands" : "rfqs"}
      onViewRfq={(project) => navigate(project?.id ? `/browse/${project.id}` : "/browse")}
      onViewBrand={(brand) => navigate(`/brands/${brand.orgId}?from=saved`)}
    />
  );
}
