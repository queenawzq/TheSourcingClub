/**
 * A vendor's profile as a brand sees it, in the shape the designed
 * `BrandFactoryProfileScreen` draws (its `live` prop, minus the handlers the
 * seam adds).
 *
 * Pure, and built on the factory's own page mapping (factory-profile-view.js)
 * so both pages say the same thing about the same profile. What nothing
 * records, or what a brand may not read (a rating, a response time, another
 * brand's orders), is left out rather than filled with an example.
 */
import { minutesPerPieceFor, monthlyUnits } from "../../lib/domain/capacity.js";
import { chipLabels, factoryProfileView } from "./factory-profile-view.js";
import { TRADING_CHIP_KINDS } from "./trading-profile-view.js";

const NOT_GIVEN = "—";
const count = (value) => Number(value).toLocaleString("en");
const given = (value) => value && value !== NOT_GIVEN;
const unique = (items) => [...new Set(items.filter(Boolean))];

/** The certification's status in the design's words: checked by TSC, or only claimed. */
function trustRow(name, status) {
  return status === "verified"
    ? { name, status: "Verified", verified: true }
    : { name, status: "Listed", verified: false };
}

/**
 * parts: what load-profile.js's loadVendorProfileForBrand() returns.
 */
export function brandFactoryView(parts, now = new Date()) {
  const own = factoryProfileView(parts, now);
  const { profile, capacity: capacityState, terms, selected } = parts;
  const data = own.data;
  const isTrading = profile?.vendor_kind === "trading_company";
  const trading = Object.fromEntries(
    Object.entries(TRADING_CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms)]),
  );
  const row = (label) => own.capacityRows.find(([name]) => name === label)?.[1] ?? NOT_GIVEN;

  const specialty = isTrading ? "Trading company" : data.productionTypes.slice(0, 2).join(", ") || "Factory";
  const location = given(data.location) ? data.location : "Location not given";
  const moq = profile?.moq != null ? `${count(profile.moq)}/style` : NOT_GIVEN;
  const category = (terms?.capacity_category ?? []).find((term) => term.id === capacityState?.capacity?.category_term_id);
  const units = monthlyUnits(capacityState?.capacity, minutesPerPieceFor(category));
  // The design's wording ("420 units"); per month in the terms list.
  const capacityUnits = units ? `${count(units)} units` : NOT_GIVEN;
  const monthly = units ? `${count(units)} units/month` : NOT_GIVEN;
  const bulkLead = given(data.leadTime) ? data.leadTime : NOT_GIVEN;
  const verified = profile?.verification_status === "verified";

  return {
    name: data.name,
    initials: own.initials,
    logoUrl: own.logoUrl,
    // The badge the brand's other screens (invite step, quotes) give a
    // verified vendor; none when it isn't.
    verifiedIcon: verified ? "trusted" : null,
    verifiedLabel: verified ? "Business registration verified" : "",
    heroLine: `${location} · ${specialty}`,
    tags: data.categories.slice(0, 4),
    performance: {
      ...own.performance,
      // The design's metrics are Club orders, MOQ and Capacity; a brand
      // can't count another brand's orders, so the first is left out.
      metrics: [
        { label: "MOQ", value: moq },
        { label: "Capacity", value: capacityUnits },
      ],
    },
    intro: data.intro,
    overviewRows: [
      [isTrading ? "Company name" : "Factory name", data.name],
      [isTrading ? "Headquarters" : "Factory location", location],
      ["Specialty", (isTrading ? trading.productionPrograms[0] : data.productionTypes.slice(0, 2).join(", ")) || NOT_GIVEN],
      ["Typical MOQ", moq],
      ["Typical bulk lead", bulkLead],
    ],
    fitSections: [
      ["Makes", data.makes.length ? data.makes : data.categories],
      ["Capabilities", isTrading
        ? unique([...trading.coreServices, ...trading.qualityCompliance])
        : unique([...data.specialties, ...data.services])],
      ["Price point", data.marketLevel ? [data.marketLevel] : []],
    ].filter(([, items]) => items.length),
    samples: data.products.slice(0, 3),
    location,
    capacityRows: [
      ["MOQ", moq],
      ["Price point", data.marketLevel || NOT_GIVEN],
      ["Bulk lead", bulkLead],
      ["Sample lead", row("Typical sample lead time")],
      ["Capacity", monthly],
      ["Availability", row("Booking level")],
    ],
    trust: [
      { name: "Business registration", status: verified ? "Verified" : "In review", verified },
      ...parts.certifications.map((cert) => trustRow(cert.name, cert.status)),
    ],
  };
}

/** The brand's back link, by where the profile was opened from. */
export const BACK_LABELS = {
  dashboard: "dashboard",
  invite: "vendor selection",
  quotes: "quotes",
  order: "order",
};

