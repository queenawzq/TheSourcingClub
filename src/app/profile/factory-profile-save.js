/**
 * Saving the factory's profile from its designed edit dialogs.
 *
 * Every write here is one onboarding (or the dashboard's capacity drawer)
 * already makes, through the same functions, so a profile edited here reads
 * back the same in onboarding, on the dashboard and in brand matching. Each
 * dialog saves only its own section: a save never touches a field or chip
 * group that dialog doesn't show.
 */
import { countryCodeFrom, firstNumber, saveFactoryProfile } from "../../lib/domain/profile.js";
import { CUSTOM_KINDS, addCustomTerm, setLinks, termLabel } from "../../lib/domain/taxonomy.js";
import { saveCapacity } from "../../lib/domain/capacity-store.js";
import { capacityWindow, monthKey } from "../../lib/domain/capacity.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { CHIP_KINDS } from "./factory-profile-view.js";
import { TRADING_CHIP_KINDS, TRADING_SECTIONS } from "./trading-profile-view.js";

const shortMonth = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });
const textOrNull = (value) => String(value ?? "").trim() || null;

async function saveOverview(org, form, terms) {
  const location = textOrNull(form.location);
  const patch = {
    intro: textOrNull(form.intro),
    legal_name: textOrNull(form.name),
    founded_year: firstNumber(form.founded),
    website_url: textOrNull(form.website),
    location,
    nearest_port: textOrNull(form.nearestPort),
    employee_count: firstNumber(form.employees),
  };
  // Re-read the country only when there is a location to read it from, so
  // clearing the field doesn't erase a code onboarding found.
  const code = countryCodeFrom(location, terms.country ?? []);
  if (code) patch.country_code = code;
  await saveFactoryProfile(org.id, patch);
}

/**
 * Labels back to term ids, kind by kind. A label the factory typed into
 * "Add your own" becomes its own term where the platform allows that, as in
 * onboarding.
 */
async function saveChipGroups(org, form, terms, kinds) {
  for (const [key, kind] of Object.entries(kinds)) {
    const chosen = form[key] ?? [];
    const known = terms[kind] ?? [];
    const termIds = [];
    for (const label of chosen) {
      let term = known.find((item) => termLabel(item) === label || termLabel(item, "zh") === label);
      if (!term && CUSTOM_KINDS.has(kind)) term = await addCustomTerm(org.id, kind, label);
      if (term) termIds.push(term.id);
    }
    await setLinks({ subjectType: "factory_profile", subjectId: org.id, orgId: org.id, kind, termIds });
  }
}

async function saveProduction(org, form, terms) {
  await saveChipGroups(org, form, terms, CHIP_KINDS);
  // Key machines are free text on the profile row, one per comma, as
  // onboarding writes them.
  await saveFactoryProfile(org.id, { equipment_notes: (form.equipment ?? []).join(", ") || null });
}

/**
 * Terms plus capacity. Months the dialog doesn't show (it shows three of the
 * six the calendar keeps) keep their saved level; the three it shows save
 * what is on screen, where an untouched month reads "Mostly open".
 *
 * A factory with no capacity yet can save its terms alone; one that has
 * capacity can't blank it out (the table needs the figure for its mode), and
 * is told so before anything is written.
 */
async function saveCapacityAndTerms(org, form, terms, hadCapacity, now) {
  const mode = form.capacityInputMode === "hours" ? "hours" : "units";
  const figure = mode === "hours" ? firstNumber(form.lineHoursInput) : firstNumber(form.capacityMonthlyUnits);
  if (!figure && hadCapacity) {
    throw new Error(mode === "hours"
      ? "Add the line-hours you have each month to save your capacity."
      : "Add the units you can make each month to save your capacity.");
  }

  await saveFactoryProfile(org.id, {
    moq: firstNumber(form.moq),
    typical_lead_days: firstNumber(form.leadTime),
    sample_lead_days: firstNumber(form.sampleLeadTime),
  });
  if (!figure) return;

  const category = (terms.capacity_category ?? []).find((term) => term.slug === form.capacityCategoryKey);
  const selections = form.capacityMonthSelections ?? {};
  const byKey = {};
  capacityWindow(6, now).forEach((month, index) => {
    const level = selections[shortMonth(month)] ?? (index < 3 ? "open" : null);
    if (level) byKey[monthKey(month)] = level;
  });
  await saveCapacity(
    org.id,
    { category_term_id: category?.id ?? null, input_mode: mode, line_hours: figure, monthly_units: figure },
    byKey,
  );
}

/**
 * The references card is the complete list, so it is replaced as a whole,
 * as onboarding does. A contact onboarding saved against a name is kept
 * while that name stays on the list.
 */
async function saveReferences(org, form, existing) {
  const contactFor = new Map(existing.map((reference) => [reference.title, reference.counterparty ?? null]));
  const titles = [...new Set(String(form.referencesText ?? "").split("\n").map((line) => line.trim()).filter(Boolean))];
  unwrap(await supabase.from("profile_references").delete().eq("org_id", org.id), "update your references");
  if (titles.length) {
    unwrap(
      await supabase.from("profile_references").insert(
        titles.map((title, sort) => ({ org_id: org.id, title, counterparty: contactFor.get(title) ?? null, sort })),
      ),
      "save your references",
    );
  }
}

/**
 * The trading company's text dialogs. Each writes the columns and chip groups
 * its onboarding questions write (migration 20260920000500 and the trading
 * taxonomy kinds), and only those.
 */
async function saveTradingSection(org, editor, form, terms) {
  if (editor === "company") {
    const location = textOrNull(form.location);
    const patch = {
      intro: textOrNull(form.intro),
      legal_name: textOrNull(form.name),
      founded_year: firstNumber(form.founded),
      website_url: textOrNull(form.website),
      location,
      employee_count: firstNumber(form.employees),
      languages_supported: textOrNull(form.languages),
    };
    const code = countryCodeFrom(location, terms.country ?? []);
    if (code) patch.country_code = code;
    return saveFactoryProfile(org.id, patch);
  }
  if (editor === "commercial") {
    return saveFactoryProfile(org.id, {
      moq: firstNumber(form.moq),
      typical_lead_days: firstNumber(form.leadTime),
      typical_order_value_band: textOrNull(form.orderValue),
      partner_factory_count: firstNumber(form.partnerFactories),
      supported_incoterms: textOrNull(form.incoterms),
      typical_payment_terms: textOrNull(form.paymentTerms),
    });
  }
  const kinds = Object.fromEntries(TRADING_SECTIONS[editor].map((key) => [key, TRADING_CHIP_KINDS[key]]));
  await saveChipGroups(org, form, terms, kinds);
  // "Other capabilities" is free text on the profile row, as onboarding writes it.
  if (editor === "services") {
    await saveFactoryProfile(org.id, { equipment_notes: (form.otherCapabilities ?? []).join(", ") || null });
  }
  return undefined;
}

/**
 * The dialogs wired to the database. The last four edit files, which save as
 * each one is added or removed (factory-profile-files.js), so their "Save
 * changes" only closes the dialog.
 */
const FILE_DIALOGS = ["banner", "walkthrough", "samples", "verification"];
export const SAVED_EDITORS = ["overview", "production", "capacity", "references", ...FILE_DIALOGS];

/** The trading company's page: its four text dialogs plus the factory's that fit it unchanged. */
const TRADING_TEXT_DIALOGS = ["company", "network", "services", "commercial"];
export const TRADING_EDITORS = [...TRADING_TEXT_DIALOGS, "references", "banner", "samples", "verification"];

/**
 * Save one dialog. `parts` is what the page loaded (terms, references,
 * capacity), so labels resolve against the same lists the dialog showed.
 */
export async function saveProfileSection(org, editor, form, parts, now = new Date()) {
  const terms = parts.terms ?? {};
  if (editor === "overview") return saveOverview(org, form, terms);
  if (editor === "production") return saveProduction(org, form, terms);
  if (editor === "capacity") return saveCapacityAndTerms(org, form, terms, Boolean(parts.capacity?.capacity), now);
  if (editor === "references") return saveReferences(org, form, parts.references ?? []);
  if (TRADING_TEXT_DIALOGS.includes(editor)) return saveTradingSection(org, editor, form, terms);
  if (FILE_DIALOGS.includes(editor)) return undefined;
  throw new Error(`The ${editor} section can't be saved yet.`);
}
