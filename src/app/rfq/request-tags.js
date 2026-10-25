import { listLinks, listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";

const TAG_KINDS = ["product_category", "certification", "service", "region"];

/** Load discovery facets for several requests while sharing one vocabulary read. */
export async function loadRequestTagMetadata(rfqs) {
  const requests = rfqs.filter(Boolean);
  const [terms, linked] = await Promise.all([
    listTermsByKind(TAG_KINDS),
    Promise.all(requests.map(async (rfq) => [rfq.id, await listLinks("rfq", rfq.id)])),
  ]);
  const linkedByRfq = new Map(linked);

  return new Map(requests.map((rfq) => {
    const ids = linkedByRfq.get(rfq.id) ?? [];
    const labels = (kind) => (terms[kind] ?? [])
      .filter((term) => ids.includes(term.id))
      .map((term) => termLabel(term));
    return [rfq.id, {
      categories: labels("product_category"),
      certifications: labels("certification"),
      services: labels("service"),
      regions: labels("region"),
    }];
  }));
}

/** Marketplace tags describe discovery facets, not facts already shown in tiles. */
export function requestTags(rfq, metadata = {}) {
  return [
    (metadata.categories ?? []).join(", "),
    rfq.quantity_total ? `MOQ ≤ ${Number(rfq.quantity_total).toLocaleString("en-US")}` : "",
    (metadata.certifications ?? []).join(", "),
    (metadata.services ?? []).join(", "),
    (metadata.regions ?? []).join(" / "),
  ].filter(Boolean);
}
