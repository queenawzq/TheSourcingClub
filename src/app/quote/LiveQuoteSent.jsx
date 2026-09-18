/**
 * The confirmation after a quote goes out, on Queena's designed screen.
 *
 * `FactoryQuoteSent` comes from src/factory-prototype/main.jsx. This file is
 * the seam — it names the brand the quote actually went to, rather than the
 * design's example.
 */
import React, { useEffect, useState } from "react";
import { FactoryQuoteSent } from "../../factory-prototype/main.jsx";
import { getRfq } from "../../lib/domain/rfq.js";
import { useRouter } from "../../lib/router.jsx";

export default function LiveQuoteSent({ rfqId, profile }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);

  useEffect(() => {
    getRfq(rfqId).then(setRfq).catch(() => setRfq(null));
  }, [rfqId]);

  return (
    <FactoryQuoteSent
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      language="en"
      project={{
        title: rfq?.title ?? "your quote",
        brand: rfq?.orgs?.name ?? "the brand",
        quantity: rfq?.quantity_total ? `${rfq.quantity_total} units` : "",
        images: [],
        tags: [],
        capacity: [],
      }}
      onBack={() => navigate(`/browse/${rfqId}/quote`)}
      onDashboard={() => navigate("/")}
    />
  );
}
