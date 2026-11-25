/**
 * A factory's own records, in the shape the designed profile page draws
 * (`factoryProfileData` in src/factory-prototype/main.jsx).
 *
 * Pure: the seam (LiveFactoryProfile.jsx) loads the rows, this only arranges
 * them, so nothing here can invent a number. Where the design shows something
 * nothing records (a rating, reviews, a response time) it is left out or said
 * plainly, never filled with an example.
 */
import { countText, daysText } from "../../lib/domain/profile.js";
import { termLabel } from "../../lib/domain/taxonomy.js";
import { equipmentList, titleFromFileName } from "../../shared/profile-translation.mjs";
import {
  CAPACITY_LEVELS,
  availableRange,
  capacityWindow,
  estimatedHours,
  minutesPerPieceFor,
  monthKey,
} from "../../lib/domain/capacity.js";

/** Designed chip group → the taxonomy kind onboarding saves it under. */
export const CHIP_KINDS = {
  manufacturingModels: "manufacturing_model",
  productionTypes: "production_type",
  categories: "product_category",
  makes: "make",
  marketLevel: "market_level",
  specialties: "specialty",
  services: "design_service",
  exportMarkets: "region",
  tools: "digital_tool",
};

const NOT_GIVEN = "—";

const shortMonth = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });
const monthYear = (iso) => new Date(iso).toLocaleString("en", { month: "short", year: "numeric" });
const dayMonth = (iso) => new Date(iso).toLocaleString("en", { month: "short", day: "numeric" });
const count = (value) => Number(value).toLocaleString("en");

export function initialsOf(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "TS";
}

/** Split on , ; new lines and the Chinese 、，； (shared with the translation, B12). */
export { equipmentList, titleFromFileName };

/**
 * One word for the business registration, wherever it is drawn (Nov 8):
 * "Verified" only once staff found the company on its current number
 * (factory_registry_fact), else what the file is.
 */
export function registrationWord(parts) {
  if (parts.registryCheckedAt) return "Verified";
  if (parts.registrationDoc?.status === "rejected") return "Rejected";
  return parts.registrationDoc ? "Uploaded" : "Not uploaded";
}

/** The design's status words for a verification document. */
export function documentStatus(status, hasFile) {
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  return hasFile ? "Uploaded" : "Not uploaded";
}

/**
 * Labels per chip group, in the taxonomy's order.
 * `selected` is getSelectedTerms() ({ kind: [termId] }), `terms` listTermsByKind().
 */
export function chipLabels(kind, selected, terms, language = "en") {
  const ids = new Set(selected?.[kind] ?? []);
  return (terms?.[kind] ?? []).filter((term) => ids.has(term.id)).map((term) => termLabel(term, language));
}

function capacityRowsFor(profile, capacityState, terms, now, language = "en") {
  const zh = language === "zh";
  const { capacity, months = {} } = capacityState ?? {};
  const category = (terms?.capacity_category ?? []).find((term) => term.id === capacity?.category_term_id);
  const minutes = minutesPerPieceFor(category);
  const window = capacityWindow(6, now);
  const current = window[0];
  const currentLevel = months[monthKey(current)];
  const range = capacity && currentLevel ? availableRange(capacity, currentLevel, minutes) : null;
  const hours = capacity ? estimatedHours(capacity, minutes) : null;
  // The person's language: Chinese months and levels are the capacity step's own words.
  const monthWord = (month) => (zh ? `${month.getUTCMonth() + 1} 月` : shortMonth(month));
  const booked = window
    .filter((month) => months[monthKey(month)])
    .slice(0, 2)
    .map((month) => {
      const level = CAPACITY_LEVELS[months[monthKey(month)]];
      return zh ? `${monthWord(month)}${level.labelZh}` : `${shortMonth(month)} ${level.labelEn.toLowerCase()}`;
    });
  const pieces = range ? (range.min === range.max ? count(range.max) : `${count(range.min)}-${count(range.max)}`) : "";
  const reference = zh ? category?.extra?.reference_style_zh ?? category?.extra?.reference_style_en : category?.extra?.reference_style_en;

  return [
    ["MOQ", profile?.moq != null ? (zh ? `${countText(profile.moq, profile.moq_max)} 件 / 款` : `${countText(profile.moq, profile.moq_max)} units / style`) : NOT_GIVEN],
    ["Typical lead time", daysText(profile?.typical_lead_days, profile?.typical_lead_days_max, zh ? "天" : "days") || NOT_GIVEN],
    ["Typical sample lead time", daysText(profile?.sample_lead_days, profile?.sample_lead_days_max, zh ? "天" : "days") || NOT_GIVEN],
    ["Capacity category", category ? termLabel(category, language) : NOT_GIVEN],
    ["Line-hours", hours ? `${capacity.input_mode === "hours" ? "" : "~"}${count(hours)} ${zh ? "小时 / 月" : "hours / month"}` : NOT_GIVEN],
    [
      "Estimated capacity",
      range ? (zh ? `${monthWord(current)}约 ${pieces} 件` : `${shortMonth(current)} roughly ${pieces} pieces`) : NOT_GIVEN,
    ],
    ["Booking level", booked.length ? booked.join(zh ? "；" : "; ") : NOT_GIVEN],
    [
      "Reference style",
      reference ? (zh ? `${reference} · 约 ${minutes} 分钟 / 件` : `${reference} · ~${minutes} min/pc`) : NOT_GIVEN,
    ],
  ];
}

/** The factory's own orders as the design's project cards. */
function projectCards(orders) {
  const card = (order, completed) => ({
    key: order.id,
    title: order.rfqs?.title ?? order.order_number ?? "Production order",
    brand: order.brand?.name ?? "Brand",
    date: completed
      ? `${monthYear(order.activated_at ?? order.created_at)} - ${monthYear(order.completed_at)}`
      : `Started ${dayMonth(order.activated_at ?? order.created_at)}`,
    result: completed ? "Completed" : order.current_milestone_title ?? "In production",
    summary: `${count(order.production_quantity ?? 0)} units${order.order_number ? ` · ${order.order_number}` : ""}`,
    rating: "",
    review: "",
    tags: [],
  });
  return {
    completed: orders.filter((order) => order.status === "completed").map((order) => card(order, true)),
    inProduction: orders.filter((order) => order.status === "active").map((order) => card(order, false)),
  };
}

const listWords = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/**
 * How complete the profile is, as the design's completion checks. Computed
 * from the data, never stored, so it can't disagree with what's filled in.
 *
 * Each check: `done` (counts towards the percent), `tone` (complete,
 * progress: waiting on TSC's review, missing), the design's `status` word,
 * a `description` written from the data, `todo` (the phrase used in "Add …
 * to strengthen this profile."), and for a missing item an `action`
 * (`{ label, editor }`, the profile dialog that fixes it) and a
 * `suggestion` for the "Suggested updates" list.
 *
 * "Verified" is only said of what an admin actually checks (the business
 * registration, certificates, a reviewed walkthrough); everything else the
 * factory fills in is "Complete".
 */
export function factoryProfileChecks(parts, now = new Date(), language = "en") {
  const { profile, selected, capacity, references, samples, registration, walkthrough, certificates = [] } = parts;
  // Chinese for a factory that chose it: the same facts, in the words of the
  // onboarding and profile dictionary (factoryMainZhText).
  const zh = language === "zh";
  const t = (en, chinese) => (zh ? chinese : en);
  const list = (items) => (zh ? items.join("、") : listWords(items));
  const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;
  const current = capacityWindow(1, now)[0];
  const monthName = zh ? `${current.getUTCMonth() + 1} 月` : current.toLocaleString("en", { month: "long", timeZone: "UTC" });
  const complete = (description, status = "Complete") => ({ tone: "complete", status: t(status, status === "Verified" ? "已验证" : "已完成"), description });
  const inReview = (description) => ({ tone: "progress", status: t("In review", "审核中"), description });
  const missing = (description, action, suggestion) => ({ tone: "missing", status: t("Needs attention", "需要处理"), description, action, suggestion });

  const identityGaps = [
    // Brands read the location the address gives (src/shared/company-address.mjs).
    [t("factory address", "工厂地址"), profile?.production_address || profile?.location],
    [t("nearest port", "最近港口"), profile?.nearest_port],
    [t("year founded", "成立年份"), profile?.founded_year],
    [t("employee count", "员工人数"), profile?.employee_count],
  ].filter(([, value]) => value == null || value === "").map(([label]) => label);
  const addressMissing = !(profile?.production_address || profile?.location);

  const productionGaps = [
    [t("manufacturing model", "生产合作模式"), has("manufacturing_model")],
    [t("production type", "生产类型"), has("production_type")],
    [t("product categories", "产品品类"), has("product_category")],
  ].filter(([, given]) => !given).map(([label]) => label);

  const capacityGaps = [
    ["MOQ", profile?.moq != null],
    [t("lead time", "交期"), profile?.typical_lead_days != null],
    [t("monthly capacity", "月产能"), Boolean(capacity?.capacity)],
  ].filter(([, given]) => !given).map(([label]) => label);

  const noFile = certificates.filter((cert) => cert.status === "Not uploaded" || cert.status === "Rejected").map((cert) => cert.name);
  const waiting = certificates.filter((cert) => cert.status === "Uploaded").map((cert) => cert.name);

  const checks = [
    {
      key: "identity",
      title: t("Factory identity", "工厂信息"),
      todo: t("your factory details", "工厂信息"),
      ...(identityGaps.length
        // Brands never see the address itself (only its city and country), so
        // a missing one is said as what to do.
        ? missing(
          addressMissing ? t(`Add your ${list(identityGaps)}.`, `请添加${list(identityGaps)}。`) : t(`Brands can't see your ${list(identityGaps)} yet.`, `品牌暂时看不到你的${list(identityGaps)}。`),
          { label: t("Update overview", "更新概览"), editor: "overview" },
          t(`Add your ${list(identityGaps)}`, `添加${list(identityGaps)}`),
        )
        : complete(t("Factory name, address, nearest port, year founded and employee count are complete.", "工厂名称、地址、最近港口、成立年份和员工人数均已完整。"))),
    },
    {
      key: "production",
      title: t("Production fit", "生产匹配"),
      todo: t("your production fit", "生产匹配"),
      ...(productionGaps.length
        ? missing(t(`Add your ${list(productionGaps)} so brands can find this factory.`, `请添加${list(productionGaps)}，方便品牌找到你的工厂。`), { label: t("Update production fit", "更新生产匹配"), editor: "production" }, t(`Add your ${list(productionGaps)}`, `添加${list(productionGaps)}`))
        : complete(t("Manufacturing model, production type and product categories are filled in, with the makes, specialties, services, markets, tools and equipment you chose.", "生产合作模式、生产类型和产品品类均已填写，并包含你选择的款式、专长、服务、市场、工具和设备。"))),
    },
    {
      key: "capacity",
      title: t("Capacity and terms", "产能与合作条件"),
      todo: t("capacity and terms", "产能与合作条件"),
      ...(capacityGaps.length
        ? missing(t(`Add your ${list(capacityGaps)} so brands know what you can take on.`, `请添加${list(capacityGaps)}，让品牌了解你能承接的订单。`), { label: t("Update capacity", "更新产能"), editor: "capacity" }, t(`Add your ${list(capacityGaps)}`, `添加${list(capacityGaps)}`))
        : complete(t("MOQ, lead times, capacity category and estimated monthly capacity are visible to brands.", "MOQ、交期、产能品类和月度估算产能均对品牌可见。"))),
    },
    {
      key: "proof",
      title: t("Client proof", "客户证明"),
      todo: t("client references and sample images", "客户参考和样品图片"),
      ...(references.length === 0
        ? missing(t("Add the brands you have worked with, so new brands can see who trusts this factory.", "请添加合作过的品牌，让新品牌了解哪些品牌信任你的工厂。"), { label: t("Add references", "添加客户参考"), editor: "references" }, t("Add client references", "添加客户参考"))
        : samples.length === 0
          ? missing(t("Client references are in. Add images of samples you have developed.", "客户参考已添加。请添加你开发过的样品图片。"), { label: t("Add sample images", "添加样品图片"), editor: "samples" }, t("Add sample images", "添加样品图片"))
          : complete(t(
            `${references.length} client reference${references.length === 1 ? "" : "s"} and ${samples.length} sample image${samples.length === 1 ? "" : "s"} support buyer trust.`,
            `${references.length} 个客户参考和 ${samples.length} 张样品图片可增强买家信任。`,
          ))),
    },
    {
      // As in the design, this row is the review state of every document:
      // the registration, plus certificates uploaded and waiting for TSC.
      key: "registration",
      title: t("Verification documents", "验证文件"),
      todo: t("your business registration", "营业执照"),
      ...(registration === "Rejected"
        ? missing(t("Your business registration wasn't accepted. Upload a new one to open quoting.", "你的营业执照未通过审核。请重新上传以开通报价。"), { label: t("Upload registration", "上传营业执照"), editor: "verification" }, t("Upload a new business registration", "重新上传营业执照"))
        : registration !== "Verified" && registration !== "Uploaded"
          ? missing(t("Upload your business registration. Quoting opens once TSC has verified it.", "请上传营业执照。TSC 验证后即可报价。"), { label: t("Upload registration", "上传营业执照"), editor: "verification" }, t("Upload your business registration", "上传营业执照"))
          : registration === "Uploaded"
            ? inReview(t(
              `Your business registration is uploaded${waiting.length ? `, and so ${waiting.length === 1 ? "is" : "are"} ${listWords(waiting)}` : ""}. TSC is reviewing ${waiting.length ? "them" : "it"}; quoting opens once the registration is approved.`,
              `营业执照${waiting.length ? `和${list(waiting)}` : ""}已上传，TSC 正在审核；营业执照通过后即可报价。`,
            ))
            : waiting.length
              ? inReview(t(`Your business registration is verified. ${listWords(waiting)} ${waiting.length === 1 ? "is" : "are"} uploaded and waiting for TSC's review.`, `营业执照已验证。${list(waiting)}已上传，等待 TSC 审核。`))
              : complete(t("Your business registration is verified, so you can quote on matching RFQs.", "营业执照已验证，你可以对匹配的询价报价。"), "Verified")),
    },
    {
      key: "walkthrough",
      title: t("Factory walkthrough", "工厂介绍视频"),
      todo: t("a walkthrough video", "工厂介绍视频"),
      ...(walkthrough
        ? complete(t("The walkthrough video is on your profile.", "工厂介绍视频已在你的资料中。"), walkthrough.status === "verified" ? "Verified" : "Complete")
        : missing(t("Add a short production-floor walkthrough so brands can see the factory before they contact you.", "请添加一段简短的生产车间介绍视频，让品牌在联系你之前先了解工厂。"), { label: t("Add walkthrough", "添加工厂介绍视频"), editor: "walkthrough" }, t("Add a walkthrough video", "添加工厂介绍视频"))),
    },
    {
      // Named after the certificate when only one needs a file, as the
      // design's "GOTS certificate" row is.
      key: "certificates",
      title: noFile.length === 1 ? t(`${noFile[0]} certificate`, `${noFile[0]} 证书`) : t("Certificate files", "证书文件"),
      todo: t("the missing certificate files", "缺少的证书文件"),
      ...(noFile.length
        ? missing(
          t(
            `${listWords(noFile)} ${noFile.length === 1 ? "has" : "have"} no accepted certificate file. Upload the certificate, or remove the certification if it is not currently held.`,
            `${list(noFile)}还没有通过的证书文件。请上传证书；如目前未持有该认证，请将其移除。`,
          ),
          { label: t("Upload certificate", "上传证书"), editor: "verification" },
          t(`Upload ${listWords(noFile)} certificate${noFile.length === 1 ? "" : "s"}`, `上传${list(noFile)}证书`),
        )
        : certificates.length
          ? complete(t(`Every certification you claim has its certificate file: ${listWords(certificates.map((cert) => cert.name))}.`, `你填写的每项认证都已有证书文件：${list(certificates.map((cert) => cert.name))}。`))
          : complete(t("No certifications claimed. Add any you hold under Verification.", "尚未填写认证。如持有认证，可在验证资料中添加。"))),
    },
    {
      key: "freshness",
      title: t("Monthly capacity freshness", "月度产能更新"),
      todo: t("this month's capacity", "本月产能"),
      ...(capacity?.months?.[monthKey(current)]
        ? complete(t(`${monthName} capacity is set, so RFQ matches use your current availability.`, `${monthName}产能已设置，询价匹配会使用你当前的可用产能。`))
        : missing(t(`${monthName} has no booking level yet. Add it to improve RFQ matching confidence.`, `${monthName}尚未设置接单状态。添加后可提高询价匹配的准确度。`), { label: t("Update capacity", "更新产能"), editor: "capacity" }, t(`Add ${monthName} available capacity`, `添加${monthName}可用产能`))),
    },
  ];
  return checks.map((check) => ({ ...check, done: check.tone !== "missing" }));
}

export function profileStatus(checks, language = "en", { trading = false } = {}) {
  const done = checks.filter((check) => check.done).length;
  const percent = Math.round((done / checks.length) * 100);
  const missing = checks.filter((check) => !check.done).map((check) => check.todo);
  if (language === "zh") {
    return {
      percent,
      note: missing.length
        ? `请添加${missing.slice(0, 2).join("、")}${missing.length > 2 ? "等" : ""}，完善资料。`
        // A trading company keeps no monthly capacity: the design's own line for it.
        : trading ? "请及时更新供应商覆盖、合规检查和采购服务信息。" : "品牌关注的信息均已填写。请及时更新月度产能。",
    };
  }
  const list = missing.length > 2
    ? `${missing.slice(0, 2).join(", ")} and more`
    : missing.join(" and ");
  return {
    percent,
    note: missing.length
      ? `Add ${list} to strengthen this profile.`
      : trading ? "Keep supplier coverage, compliance checks, and sourcing services current." : "Everything brands look for is filled in. Keep monthly capacity current.",
  };
}

/**
 * Everything the designed page needs, as its `live` prop.
 *
 * parts: { orgName, profile, terms, selected, capacity, references,
 *          certifications: [{ name, status, hasFile }], registrationDoc,
 *          logoUrl, samples: [{ title, caption, src }],
 *          walkthrough: { url, status, title, caption, created_at } | null,
 *          orders }
 */
export function factoryProfileView(parts, now = new Date(), language = "en") {
  const { orgName, profile, terms, selected, capacity, orders = [] } = parts;
  const name = orgName || profile?.legal_name;
  const chips = Object.fromEntries(
    Object.entries(CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms, language)]),
  );
  const registration = registrationWord(parts);
  const number = parts.registrationNumber;
  // The certifications the factory claims; the registration rows above them
  // are not certificates, so the completion check reads only these.
  const claimed = parts.certifications.map((cert) => ({ name: cert.name, status: documentStatus(cert.status, cert.hasFile) }));
  const certifications = [
    { name: "Business registration", status: registration },
    // Read-only: the number given on the verification step.
    ...(number ? [{ name: "Registration number", status: number.number ?? "None (sole proprietor)" }] : []),
    ...claimed,
  ];
  const references = parts.references.map((reference) => reference.title);
  const samples = parts.samples.map((sample) => ({ title: sample.title, meta: sample.caption ?? "", src: sample.src }));
  const live = orders.filter((order) => order.status !== "cancelled");
  const perBrand = live.reduce((tally, order) => tally.set(order.brand_org_id, (tally.get(order.brand_org_id) ?? 0) + 1), new Map());
  const projects = projectCards(orders);
  const verified = profile?.verification_status === "verified";
  const leadTime = daysText(profile?.typical_lead_days, profile?.typical_lead_days_max) || NOT_GIVEN;

  const data = {
    name,
    location: profile?.location || NOT_GIVEN,
    // The full address: the factory's own page only, never a brand's.
    address: profile?.production_address || profile?.location || NOT_GIVEN,
    nearestPort: profile?.nearest_port || NOT_GIVEN,
    founded: profile?.founded_year ? String(profile.founded_year) : NOT_GIVEN,
    website: profile?.website_url || NOT_GIVEN,
    employees: profile?.employee_count != null ? count(profile.employee_count) : NOT_GIVEN,
    // The badge's words follow the same source as the registration row: TSC
    // approved the company, and the registration says whether it was checked.
    // Says what was checked, as the brand's row does.
    profileVerified: !verified ? "Verification pending"
      : registration !== "Verified" ? "Approved by TSC"
      : parts.registryCheckKind === "document" ? "Registration document checked" : "Official registry checked",
    intro: profile?.intro || "",
    ...chips,
    // The taxonomy label carries a price band for choosing in onboarding
    // ("Premium / contemporary ($100-$500)"); the profile's tag is the design's
    // shorter wording, which also keeps it on one line at phone width.
    marketLevel: (chips.marketLevel[0] ?? "").replace(/\s*\([^)]*\)\s*$/, ""),
    equipment: equipmentList(profile?.equipment_notes),
    leadTime,
    clubOrders: String(live.length),
    repeatBrands: String([...perBrand.values()].filter((orderCount) => orderCount > 1).length),
    certifications,
    walkthrough: [],
    references,
    products: samples,
    pastProjects: projects.completed,
    inProductionProjects: projects.inProduction,
  };

  const checks = factoryProfileChecks(
    { profile, selected, capacity, references, samples, registration, walkthrough: parts.walkthrough, certificates: claimed },
    now,
    language,
  );

  return {
    data,
    capacityRows: capacityRowsFor(profile, capacity, terms, now, language),
    heroLine: [
      profile?.location,
      profile?.nearest_port,
      profile?.employee_count != null ? (language === "zh" ? `${count(profile.employee_count)} 名员工` : `${count(profile.employee_count)} employees`) : null,
    ].filter(Boolean).join(" · ") || (language === "zh" ? "未填写所在地" : "Location not given"),
    initials: initialsOf(name),
    logoUrl: parts.logoUrl ?? null,
    verifiedIcon: verified ? (profile?.trust_tier ?? "basic") : null,
    performance: { primary: "New", primaryLabel: "No brand reviews yet" },
    status: profileStatus(checks, language),
    walkthrough: parts.walkthrough
      ? {
        url: parts.walkthrough.url,
        title: parts.walkthrough.title
          || (parts.walkthrough.status === "verified" ? "Verified production-floor walkthrough" : "Production-floor walkthrough"),
        note: parts.walkthrough.caption || `Uploaded ${dayMonth(parts.walkthrough.created_at)}.`,
      }
      : null,
    checks,
  };
}

/** The months the capacity dialog marks up: the next three from today. */
export function bookingMonths(now = new Date()) {
  return capacityWindow(3, now).map(shortMonth);
}

/**
 * Chip-group options for the production-fit dialog: the platform's terms,
 * plus any this factory added itself. Key machines have no taxonomy, so the
 * dialog keeps the design's suggestions for them.
 */
export function factoryProfileEditOptions(terms) {
  return Object.fromEntries(
    Object.entries(CHIP_KINDS).map(([key, kind]) => [key, (terms?.[kind] ?? []).map((term) => termLabel(term))]),
  );
}

/**
 * Where each edit dialog starts: the factory's saved answers, in the form
 * fields the design's dialog uses. Numbers are written the way the profile
 * shows them ("150 units / style"); saving reads the first number back.
 */
export function factoryProfileEditForm(parts, now = new Date(), language = "en") {
  // In the person's language: "200 件 / 款" and "40-55 天" read and save as
  // "200 units / style" and "40-55 days" do (the first number, or the range).
  const zh = language === "zh";
  const { orgName, profile, terms, selected, capacity: capacityState, references = [] } = parts;
  const text = (value) => (value == null ? "" : String(value));
  const withUnit = (value, unit) => (value == null ? "" : `${value} ${unit}`);
  const row = capacityState?.capacity;
  const category = (terms?.capacity_category ?? []).find((term) => term.id === row?.category_term_id);
  const months = {};
  for (const month of capacityWindow(6, now)) {
    const level = capacityState?.months?.[monthKey(month)];
    if (level) months[shortMonth(month)] = level;
  }
  const chips = Object.fromEntries(
    Object.entries(CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms)]),
  );

  return {
    name: orgName || profile?.legal_name || "",
    address: text(profile?.production_address),
    nearestPort: text(profile?.nearest_port),
    founded: text(profile?.founded_year),
    website: text(profile?.website_url),
    employees: text(profile?.employee_count),
    intro: text(profile?.intro),
    moq: withUnit(profile?.moq != null ? countText(profile.moq, profile.moq_max) : null, zh ? "件 / 款" : "units / style"),
    leadTime: daysText(profile?.typical_lead_days, profile?.typical_lead_days_max, zh ? "天" : "days"),
    sampleLeadTime: daysText(profile?.sample_lead_days, profile?.sample_lead_days_max, zh ? "天" : "days"),
    // The dialog shows a category whatever is saved, falling back to wovens
    // as the design does; starting there means what is shown is what saves.
    capacityCategoryKey: category?.slug ?? "wovens",
    capacityInputMode: row?.input_mode ?? "units",
    lineHoursInput: row?.line_hours != null ? String(Math.round(Number(row.line_hours))) : "",
    capacityMonthlyUnits: text(row?.monthly_units),
    capacityMonthSelections: months,
    ...chips,
    marketLevel: chips.marketLevel.slice(0, 1),
    equipment: equipmentList(profile?.equipment_notes),
    referencesText: references.map((reference) => reference.title).join("\n"),
  };
}
