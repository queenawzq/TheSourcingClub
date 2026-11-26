/**
 * A web address staff type (a company's website, a registry check's link):
 * a domain or a URL, given https:// when it has no scheme (M1, M3, Nov 26).
 * The same rule as public.normalise_web_address() in SQL
 * (20261126300600_web_addresses.sql).
 *
 *   webAddress("example.com")          → "https://example.com"
 *   webAddress("http://a.pt/x?y=1")    → "http://a.pt/x?y=1"
 *   webAddress("")                     → ""
 *   webAddress("not a url")            → null
 */
const WEB_ADDRESS = /^(https?:\/\/)?[^\s/?#:@.]+(\.[^\s/?#:@.]+)*\.\p{L}{2,}(:\d{1,5})?([/?#]\S*)?$/iu;

export const WEB_ADDRESS_WORDS = "Enter a web address, e.g. example.com";

export function webAddress(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!WEB_ADDRESS.test(value)) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
