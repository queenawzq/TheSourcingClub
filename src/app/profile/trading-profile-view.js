/**
 * A trading company's own records, in the shape its designed profile page
 * draws (`TradingCompanyProfilePage` in src/factory-prototype/main.jsx).
 *
 * Pure, like factory-profile-view.js, whose helpers it shares: the seam loads
 * the rows, this only arranges them. A trading company answers its own
 * onboarding questions (programs, sourcing regions, services, commercial
 * terms), saved under their own taxonomy kinds and columns; those are what
 * this page shows. What nothing records (a rating, verified partner counts)
 * is left out.
 */
import { daysText } from "../../lib/domain/profile.js";
import { termLabel } from "../../lib/domain/taxonomy.js";
import {
  chipLabels,
  documentStatus,
  equipmentList,
  factoryProfileChecks,
  initialsOf,
  profileStatus,
} from "./factory-profile-view.js";

/** Designed chip group → the taxonomy kind the trading onboarding saves it under. */
export const TRADING_CHIP_KINDS = {
  productionPrograms: "production_program",
  productionTypes: "production_type",
  categories: "product_category",
  makes: "make",
  sourcingRegions: "sourcing_region",
  marketLevel: "market_level",
  coreServices: "core_service",
  productDevelopment: "product_development",
  qualityCompliance: "quality_compliance",
  destinationMarkets: "region",
  tools: "digital_tool",
};

/** The text dialogs, by the chip groups and fields each one saves. */
export const TRADING_SECTIONS = {
  network: ["productionPrograms", "productionTypes", "categories", "makes", "sourcingRegions", "marketLevel"],
  services: ["coreServices", "productDevelopment", "qualityCompliance", "destinationMarkets", "tools"],
};

const NOT_GIVEN = "—";
const NONE = "None selected";
const count = (value) => Number(value).toLocaleString("en");

function chipsFor(selected, terms, language = "en") {
  return Object.fromEntries(
    Object.entries(TRADING_CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms, language)]),
  );
}

const listWords = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/**
 * The completion checks, in the shape factoryProfileChecks() gives (the
 * completion page draws either). The two document checks are the factory's
 * own: a trading company files the same registration and certificates.
 */
export function tradingProfileChecks(parts, now = new Date(), language = "en") {
  const { profile, chips, references, samples, registration, certificates } = parts;
  // Chinese for a company that chose it, in the trading onboarding's words.
  const zh = language === "zh";
  const t = (en, chinese) => (zh ? chinese : en);
  const words = (items) => (zh ? items.join("、") : listWords(items));
  const complete = (description) => ({ tone: "complete", status: t("Complete", "已完成"), description });
  const missing = (description, action, suggestion) => ({ tone: "missing", status: t("Needs attention", "需要处理"), description, action, suggestion });
  const gaps = (pairs) => pairs.filter(([, given]) => !given).map(([label]) => label);

  const identityGaps = gaps([
    // Brands read the location the address gives (src/shared/company-address.mjs).
    [t("company address", "公司地址"), profile?.production_address || profile?.location],
    [t("year founded", "成立年份"), profile?.founded_year],
    [t("team size", "团队人数"), profile?.employee_count != null],
    [t("languages", "支持语言"), profile?.languages_supported],
  ]);
  const networkGaps = gaps([
    [t("production programs", "生产合作模式"), chips.productionPrograms.length],
    [t("product categories", "产品品类"), chips.categories.length],
    [t("sourcing regions", "采购地区"), chips.sourcingRegions.length],
  ]);
  const servicesGaps = gaps([
    [t("core services", "核心服务"), chips.coreServices.length],
    [t("quality and compliance checks", "质量与合规检查"), chips.qualityCompliance.length],
  ]);
  const commercialGaps = gaps([
    [t("typical MOQ", "常规最低起订量"), profile?.moq != null],
    [t("lead time", "交期"), profile?.typical_lead_days != null],
    [t("number of partner factories", "活跃合作工厂数量"), profile?.partner_factory_count != null],
  ]);
  const documents = factoryProfileChecks(
    { profile, selected: {}, capacity: null, references, samples, registration, walkthrough: null, certificates },
    now,
    language,
  ).filter((check) => check.key === "registration" || check.key === "certificates");

  const checks = [
    {
      key: "identity",
      title: t("Company identity", "公司信息"),
      todo: t("your company details", "公司信息"),
      ...(identityGaps.length
        // Brands never see the address itself (only its city and country), so
        // a missing one is said as what to do.
        ? missing(
          !(profile?.production_address || profile?.location)
            ? t(`Add your ${words(identityGaps)}.`, `请添加${words(identityGaps)}。`)
            : t(`Brands can't see your ${words(identityGaps)} yet.`, `品牌暂时看不到你的${words(identityGaps)}。`),
          { label: t("Update overview", "更新概览"), editor: "company" },
          t(`Add your ${words(identityGaps)}`, `添加${words(identityGaps)}`),
        )
        : complete(t("Company name, address, year founded, team size and languages are complete.", "公司名称、地址、成立年份、团队人数和支持语言均已完整。"))),
    },
    {
      key: "network",
      title: t("Supplier network", "供应商网络"),
      todo: t("your supplier network", "供应商网络"),
      ...(networkGaps.length
        ? missing(t(`Add your ${words(networkGaps)} so brands can find your network.`, `请添加${words(networkGaps)}，方便品牌找到你的供应商网络。`), { label: t("Update supplier network", "更新供应商网络"), editor: "network" }, t(`Add your ${words(networkGaps)}`, `添加${words(networkGaps)}`))
        : complete(t("Production programs, product categories and sourcing regions are filled in.", "生产合作模式、产品品类和采购地区均已填写。"))),
    },
    {
      key: "services",
      title: t("Services and oversight", "服务与监督"),
      todo: t("your services", "服务信息"),
      ...(servicesGaps.length
        ? missing(t(`Add your ${words(servicesGaps)} so brands know what your team manages.`, `请添加${words(servicesGaps)}，让品牌了解你的团队负责哪些工作。`), { label: t("Update services", "更新服务"), editor: "services" }, t(`Add your ${words(servicesGaps)}`, `添加${words(servicesGaps)}`))
        : complete(t("Core services and quality checks are visible to brands.", "核心服务和质量检查均对品牌可见。"))),
    },
    {
      key: "commercial",
      title: t("Commercial terms", "商务条件"),
      todo: t("commercial terms", "商务条件"),
      ...(commercialGaps.length
        ? missing(t(`Add your ${words(commercialGaps)} so brands know what you can take on.`, `请添加${words(commercialGaps)}，让品牌了解你能承接的订单。`), { label: t("Update commercial terms", "更新商务条件"), editor: "commercial" }, t(`Add your ${words(commercialGaps)}`, `添加${words(commercialGaps)}`))
        : complete(t("MOQ, lead time and partner factory coverage are visible to brands.", "MOQ、交期和合作工厂信息均对品牌可见。"))),
    },
    {
      key: "proof",
      title: t("Client proof", "客户证明"),
      todo: t("client references and sourcing work", "客户参考和采购项目"),
      ...(references.length === 0
        ? missing(t("Add the brands you have worked with, so new brands can see who trusts your company.", "请添加合作过的品牌，让新品牌了解哪些品牌信任你的公司。"), { label: t("Add references", "添加客户参考"), editor: "references" }, t("Add client references", "添加客户参考"))
        : samples.length === 0
          ? missing(t("Client references are in. Add images of products you have sourced.", "客户参考已添加。请添加你采购过的产品图片。"), { label: t("Add sourcing work", "添加采购项目"), editor: "samples" }, t("Add recent sourcing work", "添加近期采购项目"))
          : complete(t(
            `${references.length} client reference${references.length === 1 ? "" : "s"} and ${samples.length} sourcing image${samples.length === 1 ? "" : "s"} support buyer trust.`,
            `${references.length} 个客户参考和 ${samples.length} 张采购项目图片可增强买家信任。`,
          ))),
    },
    ...documents,
  ];
  return checks.map((check) => ({ ...check, done: check.tone !== "missing" }));
}

/**
 * Everything the designed trading page needs, as its `live` prop (the seam
 * adds the dialogs' handlers).
 *
 * parts: what load-profile.js's loadOwnProfile() returns.
 */
export function tradingProfileView(parts, now = new Date(), language = "en") {
  const { orgName, profile, terms, selected, orders = [] } = parts;
  // The values in the person's language; the page's labels are translated by
  // its own Chinese layer (the design's dictionary).
  const zh = language === "zh";
  const t = (en, chinese) => (zh ? chinese : en);
  const name = orgName || profile?.legal_name;
  const chips = chipsFor(selected, terms, language);
  const orNone = (items) => (items.length ? items : [t(NONE, "未选择")]);
  const location = profile?.location || NOT_GIVEN;
  const team = profile?.employee_count != null ? count(profile.employee_count) : null;
  const verified = profile?.verification_status === "verified";
  // One word for the registration, as on every page (registrationWord).
  const registration = parts.registryCheckedAt ? "Verified"
    : parts.registrationDoc?.status === "rejected" ? "Rejected"
    : parts.registrationDoc ? "Uploaded" : "Not uploaded";
  const certificates = parts.certifications.map((cert) => ({ name: cert.name, status: documentStatus(cert.status, cert.hasFile) }));
  const statusWord = (status) => (zh ? { Verified: "已验证", Uploaded: "已上传", "Not uploaded": "未上传", Rejected: "未通过" }[status] ?? status : status);
  const samples = parts.samples.map((sample) => ({ title: sample.title, meta: sample.caption ?? "", src: sample.src }));
  const references = parts.references.map((reference) => reference.title);
  const live = orders.filter((order) => order.status !== "cancelled");
  const perBrand = live.reduce((tally, order) => tally.set(order.brand_org_id, (tally.get(order.brand_org_id) ?? 0) + 1), new Map());

  const checks = tradingProfileChecks(
    { profile, chips, references: parts.references, samples, registration, certificates },
    now,
    language,
  );

  return {
    name,
    initials: initialsOf(name),
    logoUrl: parts.logoUrl ?? null,
    verifiedIcon: verified ? (profile?.trust_tier ?? "basic") : null,
    verifiedLabel: verified ? t("Business verified", "企业已验证") : "",
    heroLine: [
      profile?.location,
      t("Trading company", "贸易公司"),
      team ? t(`${team}-person sourcing team`, `${team} 人采购团队`) : null,
    ].filter(Boolean).join(" · "),
    tags: chips.coreServices.slice(0, 3),
    performance: {
      primary: "New",
      primaryLabel: "No brand reviews yet",
      metrics: [
        { label: "Club orders", value: String(live.length) },
        { label: "Repeat brands", value: String([...perBrand.values()].filter((n) => n > 1).length) },
      ],
    },
    intro: profile?.intro || "",
    overviewRows: [
      ["Company name", name],
      ["Year founded", profile?.founded_year ? String(profile.founded_year) : NOT_GIVEN],
      ["Website URL", profile?.website_url || NOT_GIVEN],
      // The full address: the company's own page only.
      ["Company address", profile?.production_address || profile?.location || NOT_GIVEN],
      ["Team size", team ? t(`${team} people`, `${team} 人`) : NOT_GIVEN],
      ["Languages", profile?.languages_supported || NOT_GIVEN],
    ],
    // What a brand sees, for the page's public view.
    publicOverviewRows: [
      ["Company name", name],
      ["Year founded", profile?.founded_year ? String(profile.founded_year) : NOT_GIVEN],
      ["Website URL", profile?.website_url || NOT_GIVEN],
      ["Headquarters", location],
      ["Team size", team ? t(`${team} people`, `${team} 人`) : NOT_GIVEN],
      ["Languages", profile?.languages_supported || NOT_GIVEN],
    ],
    networkSections: [
      ["Production programs", orNone(chips.productionPrograms)],
      ["Production type", orNone(chips.productionTypes)],
      ["Product categories", orNone(chips.categories)],
      ["Products sourced", orNone(chips.makes)],
      ["Sourcing regions", orNone(chips.sourcingRegions)],
      ["Market level", orNone(chips.marketLevel)],
    ],
    servicesSections: [
      ["Core services", orNone(chips.coreServices)],
      ["Product development", orNone(chips.productDevelopment)],
      ["Quality and compliance", orNone(chips.qualityCompliance)],
      ["Primary destination markets", orNone(chips.destinationMarkets)],
      ["Digital tools", orNone(chips.tools)],
    ],
    commercialRows: [
      ["Typical MOQ", profile?.moq != null ? t(`${count(profile.moq)} units / style`, `${count(profile.moq)} 件 / 款`) : NOT_GIVEN],
      ["Typical lead time", daysText(profile?.typical_lead_days, profile?.typical_lead_days_max, t("days", "天")) || NOT_GIVEN],
      ["Typical order value", profile?.typical_order_value_band || NOT_GIVEN],
      ["Partner factories", profile?.partner_factory_count != null ? t(`${count(profile.partner_factory_count)} active`, `${count(profile.partner_factory_count)} 家活跃工厂`) : NOT_GIVEN],
      ["Incoterms", profile?.supported_incoterms || NOT_GIVEN],
      ["Payment terms", profile?.typical_payment_terms || NOT_GIVEN],
    ],
    samples,
    trust: [
      { name: t("Business registration", "营业执照"), status: registration },
      ...certificates,
    ].map((item) => ({ ...item, status: statusWord(item.status), verified: item.status === "Verified" || item.status === "Uploaded" })),
    references,
    snapshotRows: [
      ["Active factories", profile?.partner_factory_count != null ? count(profile.partner_factory_count) : NOT_GIVEN],
      ["Sourcing regions", String(chips.sourcingRegions.length)],
      ["Primary markets", chips.destinationMarkets.length ? chips.destinationMarkets.join(" · ") : NOT_GIVEN],
    ],
    location,
    status: profileStatus(checks, language, { trading: true }),
    checks,
  };
}

/** Option lists for the trading dialogs' chip groups: the platform's terms plus the company's own. */
export function tradingProfileEditOptions(terms) {
  return Object.fromEntries(
    Object.entries(TRADING_CHIP_KINDS).map(([key, kind]) => [key, (terms?.[kind] ?? []).map((term) => termLabel(term))]),
  );
}

/** Where each trading dialog starts: the company's saved answers. */
export function tradingProfileEditForm(parts, language = "en") {
  // "300 件 / 款" and "45-60 天" save as their English forms do.
  const zh = language === "zh";
  const { orgName, profile, terms, selected, references = [] } = parts;
  const text = (value) => (value == null ? "" : String(value));
  const chips = chipsFor(selected, terms);
  return {
    name: orgName || profile?.legal_name || "",
    founded: text(profile?.founded_year),
    website: text(profile?.website_url),
    address: text(profile?.production_address),
    employees: text(profile?.employee_count),
    languages: text(profile?.languages_supported),
    intro: text(profile?.intro),
    ...chips,
    marketLevel: chips.marketLevel.slice(0, 1),
    otherCapabilities: equipmentList(profile?.equipment_notes),
    moq: profile?.moq != null ? `${profile.moq} ${zh ? "件 / 款" : "units / style"}` : "",
    leadTime: daysText(profile?.typical_lead_days, profile?.typical_lead_days_max, zh ? "天" : "days"),
    orderValue: text(profile?.typical_order_value_band),
    partnerFactories: text(profile?.partner_factory_count),
    incoterms: text(profile?.supported_incoterms),
    paymentTerms: text(profile?.typical_payment_terms),
    referencesText: references.map((reference) => reference.title).join("\n"),
  };
}
