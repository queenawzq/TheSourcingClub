/**
 * A verified, published factory whose profile is written in Chinese, linked
 * to Brand two (Maple Row Studio): invited to its "Organic baby rompers"
 * request, with a sent quote, saved under the brand's Saved vendors, and a
 * conversation on that request with one message from the factory. A brand
 * opening it sees the profile translated into English, with "See original".
 *
 * Every field the vendor page, the Browse card, the dashboard card and the
 * factory's own profile and completion page read is filled, the way the
 * fullest demo factory is, so no screen falls back to empty. Written through
 * the factory's and the brand's own logins wherever a person would write it;
 * the service key only for what TSC itself writes (verification, credits,
 * delivering a checked message).
 *
 * Called by scripts/seed-demo.mjs, and on its own by
 * scripts/seed-demo-zh-factory.mjs, which adds just this company to a test
 * database without reseeding the others.
 */
import { readFileSync } from "node:fs";
import { demoPdf } from "./demo-target.mjs";

export const ZH_FACTORY_REQUEST = "Organic baby rompers";

// The company's name is the name as typed: names are never translated.
const PROFILE = {
  legal_name: "宁波晨织服饰有限公司",
  website_url: "https://chenzhi-knit.example.com",
  country_code: "CN",
  location: "浙江省宁波市鄞州区",
  nearest_port: "宁波港",
  founded_year: 2011,
  employee_count: 160,
  moq: 200,
  typical_lead_days: 35,
  sample_lead_days: 7,
  equipment_notes: "电脑横机, 单面圆机, 双面圆机, 平缝机, 包缝机, 绷缝机, 自动裁床",
  intro: "我们是位于宁波的针织服装工厂，拥有8条生产线和160名员工，专做圆机针织T恤、卫衣、婴童连体衣和横机毛衫。最低起订量200件/款，打样周期7天，大货周期35天。可提供GOTS认证有机棉面料，并在每个生产节点发送QC照片。",
};

const TAGS = [
  ["manufacturing_model", "oem"], ["manufacturing_model", "full-package"],
  ["production_type", "cut-sew-knits"], ["production_type", "sweaters-knitwear"],
  ["product_category", "tops"], ["product_category", "childrenswear-baby"], ["product_category", "womenswear"],
  ["make", "rib-tops"],
  ["market_level", "mid-range"],
  ["specialty", "gots-cotton"], ["specialty", "low-moq-sampling"], ["specialty", "qc-photo-updates"],
  ["design_service", "pattern-making"], ["design_service", "sample-development"],
  ["region", "europe"], ["region", "united-states"],
  ["digital_tool", "clo-3d"],
];

const REFERENCES = [
  "英国有机童装品牌（2021年至今）",
  "加拿大女装品牌，罗纹上衣季度返单",
  "欧洲运动品牌，卫衣订单5000件",
];

// The repo's sample-garment photos, each with a Chinese name and description.
const SAMPLES = [
  ["dashboard-rfq-knit.jpg", "有机棉罗纹婴儿连体衣.jpg", "童装 · GOTS有机棉 · 起订量200件"],
  ["dashboard-rfq-shirt.jpg", "圆机针织T恤.jpg", "针织 · 32支精梳棉 · 打样7天"],
  ["dashboard-rfq-denim.jpg", "毛圈卫衣产前样.jpg", "卫衣 · 320克毛圈布 · 产前样"],
];

// A Unified Social Credit Code with a valid check character (fake).
const CREDIT_CODE = "91330212MA2H8K6L4G";

const QUOTE = {
  price: 2050,
  quantity: 350,
  lead: 35,
  note: "报价含一次试身样和产前样，FOB宁波。面料为GOTS认证有机棉，按扣使用无镍金属扣，可提供检测报告。",
  answer: "确认样衣后两周内可以开始生产。",
  shipping: "FOB 宁波",
};
const MESSAGE = "您好，我们已经收到连体衣的需求。请问按扣颜色需要和面料同色吗？我们可以先寄面料色卡给您确认。";

const firstOfMonth = (offset) => {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
};

/**
 * @param admin    service-key client
 * @param factory  { client, id } signed in as the factory's login
 * @param name     the company name
 * @param brand    { client, id, org } Brand two's owner, signed in
 * @param staff    a platform admin's signed-in client, or null (skips the registry check)
 */
export async function seedZhFactory({ admin, factory, name, brand, staff }) {
  const must = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  const termId = async (kind, slug) => (must(await admin
    .from("taxonomy_terms").select("id").eq("kind", kind).eq("slug", slug).single(), `${kind}/${slug}`)).id;

  const org = must(await factory.client.rpc("create_org", { org_name: name, org_kind: "factory" }), "create the Chinese-profile factory");
  const now = new Date().toISOString();
  must(await admin.from("factory_profiles").upsert({
    org_id: org.id, ...PROFILE,
    onboarding_completed_at: now, verification_status: "verified", trust_tier: "verified", published_at: now,
  }), "its profile");
  // The grant a verified vendor gets, as every demo factory has it.
  must(await admin.from("credit_ledger").insert({
    org_id: org.id, delta: 500, reason: "onboarding_grant", note: "Profile verified",
  }), "its credits");

  // The profile as onboarding and the profile's dialogs fill it, through its own login.
  must(await factory.client.from("taxonomy_links").insert(await Promise.all(TAGS.map(async ([kind, slug]) => ({
    subject_type: "factory_profile", subject_id: org.id, org_id: org.id, term_id: await termId(kind, slug),
  })))), "its tags");
  must(await factory.client.from("factory_capacity").insert({
    org_id: org.id, category_term_id: await termId("capacity_category", "cut-sew-knits"), input_mode: "units", monthly_units: 8000,
  }), "its capacity");
  must(await factory.client.from("factory_capacity_months").insert(
    ["open", "partial", "open", "full", "partial", "open"].map((level, offset) => ({ org_id: org.id, month: firstOfMonth(offset), level })),
  ), "its booking calendar");
  must(await factory.client.from("profile_references").insert(
    REFERENCES.map((title, sort) => ({ org_id: org.id, title, sort })),
  ), "its references");

  // GOTS with its certificate checked by TSC; OEKO-TEX with its certificate
  // waiting for review, as an upload leaves it.
  for (const [slug, fileName, status] of [
    ["gots", "GOTS证书.pdf", "verified"],
    ["oeko-tex-standard-100", "OEKO-TEX证书.pdf", "pending"],
  ]) {
    const path = `${org.id}/certificate/${crypto.randomUUID()}-certificate.pdf`;
    const bytes = demoPdf(`${slug} certificate.pdf`);
    must(await factory.client.storage.from("org-private").upload(path, bytes, { contentType: "application/pdf" }), `upload ${fileName}`);
    const doc = must(await admin.from("documents").insert({
      org_id: org.id, kind: "certificate", bucket: "org-private", storage_path: path,
      file_name: fileName, mime_type: "application/pdf", size_bytes: bytes.length, status,
      ...(status === "verified" ? { reviewed_at: now } : {}),
    }).select("id").single(), `record ${fileName}`);
    must(await admin.from("factory_certifications").insert({
      org_id: org.id, term_id: await termId("certification", slug), document_id: doc.id, status,
    }), `its ${slug} certification`);
  }

  // The business licence behind the verified profile, as TSC's review leaves it.
  {
    const path = `${org.id}/business_registration/${crypto.randomUUID()}-business-licence.pdf`;
    const bytes = demoPdf("Business licence.pdf");
    must(await factory.client.storage.from("org-private").upload(path, bytes, { contentType: "application/pdf" }), "upload its licence");
    must(await admin.from("documents").insert({
      org_id: org.id, kind: "business_registration", bucket: "org-private", storage_path: path,
      file_name: "营业执照.pdf", mime_type: "application/pdf", size_bytes: bytes.length, status: "verified", reviewed_at: now,
    }), "record its licence");
  }
  must(await factory.client.rpc("save_company_registration", { target_org: org.id, country: "CN", number: CREDIT_CODE }), "its credit code");
  if (staff) {
    must(await staff.rpc("admin_record_registry_check", {
      target_org: org.id, source: "document", result: "found", note: "Demo: licence shows this code and the name",
    }), "its registry check");
  }

  for (const [file, fileName, caption] of SAMPLES) {
    const path = `${org.id}/product_image/${crypto.randomUUID()}-${file}`;
    const bytes = readFileSync(new globalThis.URL(`../assets/${file}`, import.meta.url));
    must(await factory.client.storage.from("org-public").upload(path, bytes, { contentType: "image/jpeg" }), `upload ${fileName}`);
    must(await factory.client.from("documents").insert({
      org_id: org.id, kind: "product_image", bucket: "org-public", storage_path: path,
      file_name: fileName, mime_type: "image/jpeg", size_bytes: bytes.length,
      title: fileName.replace(/\.jpg$/, ""), caption,
    }), `record ${fileName}`);
  }

  // Brand two invites it to its rompers request, the way the invite step does.
  const rfq = must(await admin.from("rfqs").select("id, title")
    .eq("brand_org_id", brand.org.id).eq("title", ZH_FACTORY_REQUEST).eq("status", "open").limit(1).single(),
  `Brand two's "${ZH_FACTORY_REQUEST}" request`);
  must(await brand.client.from("rfq_invitations").insert({ rfq_id: rfq.id, factory_org_id: org.id }), "the invitation");

  // A quote sent through the factory's own login, as the quote form sends it.
  const quote = must(await factory.client.from("quotes").insert({
    rfq_id: rfq.id,
    factory_org_id: org.id,
    unit_price_cents: QUOTE.price,
    production_quantity: QUOTE.quantity,
    bulk_lead_time_days: QUOTE.lead,
    deposit_pct: 30,
    balance_pct: 70,
    payment_term_id: await termId("payment_term", "deposit-30-70"),
    incoterm_id: await termId("incoterm", "fob"),
    valid_until: new Date(Date.now() + 21 * 864e5).toISOString(),
    factory_notes: QUOTE.note,
    // What the quote form writes beside the matched ids, so the read-back
    // shows the vendor's own words for shipping, its answer and its window.
    shipping_notes: QUOTE.shipping,
    factory_response: QUOTE.answer,
    capacity_window_start: firstOfMonth(1),
    capacity_window_end: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 2, 0)).toISOString().slice(0, 10),
    capacity_window_units: QUOTE.quantity,
  }).select("id").single(), "the quote");
  must(await factory.client.from("quote_sample_lines").insert({
    quote_id: quote.id, stage: "Fit sample", cost_cents: 6500, timing_days: 7, sort: 0,
  }), "its sample line");
  const [question] = must(await factory.client.from("rfq_questions").select("id").eq("rfq_id", rfq.id).order("sort"), "the request's questions");
  if (question) {
    must(await factory.client.from("quote_question_answers").insert({
      quote_id: quote.id, question_id: question.id, answer_text: QUOTE.answer,
    }), "its answer");
  }
  must(await factory.client.rpc("submit_quote", { quote_id: quote.id }), "send the quote");

  // The brand keeps it under Saved vendors.
  must(await brand.client.from("saved_factories").insert({
    org_id: brand.org.id, factory_org_id: org.id, saved_by: brand.id,
  }), "Brand two saves it");

  // A conversation on the request, with one message from the factory. Saved
  // to be checked first, like every message, then delivered with the secret
  // key, as api/screen-message.js does.
  const thread = must(await factory.client.rpc("open_rfq_thread", { target_rfq: rfq.id, factory_org: org.id }), "the conversation");
  const threadId = thread?.id ?? thread;
  const message = must(await factory.client.from("messages").insert({
    thread_id: threadId, sender_org_id: org.id, sender_user_id: factory.id, body: MESSAGE,
  }).select("id").single(), "its message");
  must(await admin.rpc("record_message_screening", {
    target_message: message.id, outcome: "delivered", method: "pattern_only",
  }), "deliver its message");

  return { org, rfq, quote, threadId, message };
}
