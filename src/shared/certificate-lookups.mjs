/**
 * Where staff check a factory's certificate on the issuer's own public
 * lookup, by certification taxonomy slug (verification v2). Each URL was
 * opened live on Nov 8, 2026:
 *
 *   - OEKO-TEX: the detail page takes the label number and says valid or not.
 *   - GOTS: the certified-suppliers database takes a name or number in `q`.
 *   - Fair Trade USA: the partner directory takes a name or FTUSA ID.
 *   - GRS (Textile Exchange), WRAP, FLOCERT: search page only, no prefill.
 *   - amfori BSCI: no public lookup (members only); staff read the audit
 *     report the factory uploaded.
 *   - Anything else (ISO and so on): IAF CertSearch by name, which asks for a
 *     captcha before its results.
 *
 * `url(number, name)` returns the link; `prefill` says whether it carries
 * the number or name, so the screen can say "Copy number" first when not.
 */
const enc = encodeURIComponent;

export const CERTIFICATE_LOOKUPS = {
  "oeko-tex-standard-100": { label: "OEKO-TEX label check", prefill: "number", url: (number) => (number ? `https://www.oeko-tex.com/en/detail/?number=${enc(number)}` : "https://www.oeko-tex.com/en/label-check") },
  gots: { label: "GOTS certified suppliers", prefill: "number or name", url: (number, name) => `https://global-standards.org/suppliers/certified-suppliers?q=${enc(number || name || "")}` },
  grs: { label: "Textile Exchange certified companies (GRS)", prefill: null, url: () => "https://textileexchange.org/find-certified-company/" },
  wrap: { label: "WRAP certified facilities", prefill: null, url: () => "https://wrap-maps.azurewebsites.net/facility-map" },
  bsci: { label: null, prefill: null, url: () => null, note: "amfori has no public lookup: check the audit report" },
  "fair-trade": { label: "Fair Trade USA partner directory", prefill: "number or name", url: (number, name) => `https://partner.fairtradecertified.org/directory/results/?name=${enc(number || name || "")}`, also: { label: "FLOCERT customer search", url: "https://www.flocert.net/fairtrade-customer-search/" } },
};

const OTHER = { label: "IAF CertSearch", prefill: "name", url: (number, name) => `https://www.iafcertsearch.org/search/certified-entities?search=${enc(name || number || "")}` };

export function certificateLookup(slug) {
  return CERTIFICATE_LOOKUPS[slug] ?? OTHER;
}

/** Reverse image search links for a photo anyone can open by its URL. */
export function reverseImageLinks(imageUrl) {
  const url = enc(imageUrl);
  return [
    { key: "lens", label: "Google Lens", href: `https://lens.google.com/uploadbyurl?url=${url}` },
    { key: "tineye", label: "TinEye", href: `https://tineye.com/search?url=${url}` },
    { key: "yandex", label: "Yandex", href: `https://yandex.com/images/search?rpt=imageview&url=${url}` },
  ];
}

/** Map links for a point: OpenStreetMap, and Google Maps' satellite view. */
export function mapLinks(lat, lon) {
  return [
    { key: "osm", label: "OpenStreetMap", href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}` },
    { key: "satellite", label: "Google Maps satellite", href: `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lon}&zoom=18&basemap=satellite` },
  ];
}
