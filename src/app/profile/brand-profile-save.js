/**
 * Saving the brand profile's edit dialogs.
 *
 * Each dialog saves what brand onboarding saves for the same question, through
 * the same functions (saveBrandProfile and setLinks) and the same mapping
 * (brand-profile-fields.js), so a profile edited here reads back the same in
 * onboarding, the admin queue and match scoring. Files save as they are
 * chosen, in factory-profile-files.js.
 */
import { saveBrandProfile } from "../../lib/domain/profile.js";
import { setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { CATEGORY_KIND, COLUMN_FOR_LABEL, columnValue, parsePriceRange } from "../../lib/domain/brand-profile-fields.js";

/** The dialogs the live page opens. "projects" and "payment" have nothing behind them. */
export const BRAND_EDITORS = ["overview", "sourcing", "sourcingVolume", "stakeholders", "verification", "banner", "assets"];

/** The sourcing-fit dialog's chip groups → taxonomy kind. */
const FIT_KINDS = {
  products: "product_category",
  marketLevel: "market_level",
  preferredRegions: "region",
  certifications: "certification",
  services: "service",
};

const column = (label) => COLUMN_FOR_LABEL[label];

/** Chosen labels back to the term ids they came from. */
const termIds = (terms, kind, labels) =>
  (terms?.[kind] ?? []).filter((term) => (labels ?? []).includes(termLabel(term))).map((term) => term.id);

function foundedYear(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) throw new Error("Year founded should be a year, like 2019.");
  return Number(value);
}

/**
 * parts: what loadOwnBrandProfile() returned (for the taxonomy terms).
 */
export async function saveBrandProfileSection(org, editor, form, parts) {
  const { terms } = parts;
  const link = (kind, labels) =>
    setLinks({ subjectType: "brand_profile", subjectId: org.id, orgId: org.id, kind, termIds: termIds(terms, kind, labels) });

  if (editor === "overview") {
    const categories = (terms?.[CATEGORY_KIND] ?? []).filter((term) => (form.brandCategories ?? []).includes(termLabel(term)));
    await saveBrandProfile(org.id, {
      [column("Brand name")]: columnValue(column("Brand name"), form.name),
      [column("Business email")]: columnValue(column("Business email"), form.businessEmail),
      [column("Year founded")]: foundedYear(form.founded),
      [column("Website URL")]: columnValue(column("Website URL"), form.website),
      [column("HQ location")]: columnValue(column("HQ location"), form.location),
      [column("About the brand")]: columnValue(column("About the brand"), form.intro),
      // The column keeps the first choice, as onboarding does.
      brand_category: categories[0]?.slug ?? null,
    });
    await link(CATEGORY_KIND, form.brandCategories);
    return;
  }

  if (editor === "sourcing") {
    // One kind at a time, as onboarding: a blanket delete would wipe groups
    // this dialog never showed.
    for (const [key, kind] of Object.entries(FIT_KINDS)) await link(kind, form[key]);
    return;
  }

  if (editor === "sourcingVolume") {
    const volume = form.sourcingVolume ?? {};
    await saveBrandProfile(org.id, {
      [column("Average pieces ordered per year")]: columnValue("pieces_per_year_band", volume.annualVolume),
      [column("Typical order size per style")]: columnValue("order_size_band", volume.orderSize),
      [column("Collections per year")]: columnValue("collections_per_year", volume.collectionsPerYear),
      [column("Typical reorder cadence")]: columnValue("reorder_cadence", volume.reorderCadence),
      [column("Current sourcing stage")]: columnValue("sourcing_stage", volume.sourcingStage),
      ...parsePriceRange(volume.targetPrice),
    });
    return;
  }

  if (editor === "verification") {
    await saveBrandProfile(org.id, { [column("Business email")]: columnValue("business_email", form.businessEmail) });
  }
}
