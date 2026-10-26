/** Card copy comes from profile facts, never invented marketing claims. */
export function vendorSummary({ makes = [], specialties = [], intro = "" } = {}) {
  const unique = (items) => [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
  const products = unique(makes).slice(0, 3);
  const skills = unique(specialties).filter((item) => !products.includes(item)).slice(0, 2);
  const facts = [products.length ? `Makes: ${products.join(", ")}.` : "", skills.length ? `Specializes in: ${skills.join(", ")}.` : ""].filter(Boolean).join(" ");
  const text = facts || String(intro ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 180) return text;
  const excerpt = text.slice(0, 177);
  const boundary = excerpt.lastIndexOf(" ");
  return `${boundary > 130 ? excerpt.slice(0, boundary) : excerpt}…`;
}
