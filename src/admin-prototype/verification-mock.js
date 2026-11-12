/**
 * Mock data for the Nov 12 staff verification review design (mock only).
 *
 * One scoring system, as Queena asked on Nov 11: every row is a percentage.
 * A group's score is the weighted mean of its checks; the overall score is
 * Business registration 60 + Company information 40. Certification evidence
 * is shown but not counted: many real factories hold none.
 *
 * A check that has not been done scores 0 and says so, so an unchecked
 * registry can never look like a passed one.
 *
 * The shape is meant to be ported: `verification.groups[].checks[]` is what a
 * real scoring function would return, and `scoreGroup` / `scoreOverall` are
 * the arithmetic the live page would share.
 */

export const GROUP_WEIGHTS = { business_registration: 60, company_information: 40 };

export function scoreGroup(group) {
  const counted = group.checks.filter((check) => check.weight);
  if (!counted.length) return group.checks[0]?.score ?? null;
  const total = counted.reduce((sum, check) => sum + check.weight, 0);
  return Math.round(counted.reduce((sum, check) => sum + (check.score ?? 0) * check.weight, 0) / total);
}

export function scoreOverall(groups) {
  let sum = 0;
  let weight = 0;
  for (const group of groups) {
    const w = GROUP_WEIGHTS[group.key];
    if (!w) continue;
    sum += scoreGroup(group) * w;
    weight += w;
  }
  return Math.round(sum / weight);
}

/** The lowest counted check that has been done: the overall line names it. A check not done yet is a to-do, not evidence. */
export function weakestCheck(groups) {
  return groups
    .filter((group) => GROUP_WEIGHTS[group.key])
    .flatMap((group) => group.checks.filter((check) => check.weight && check.score != null).map((check) => ({ ...check, group: group.label })))
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
}

/** Fit tiers from TSC_DESIGN_SYSTEM.md, plus "tradeoff" for a low score. */
export function tierFor(score) {
  if (score == null) return "none";
  if (score >= 90) return "strong";
  if (score >= 75) return "good";
  if (score >= 60) return "potential";
  return "low";
}

export function standingFor(score) {
  if (score >= 85) return { word: "Strong", tone: "strong" };
  if (score >= 60) return { word: "Needs a look", tone: "potential" };
  return { word: "Flagged", tone: "low" };
}

export const GROUP_TIPS = {
  business_registration: "The licence and the official registry: is this a registered company? Counts for 60% of the score.",
  company_information: "Factory or trader, and whether the address and photos are its own. Counts for 40% of the score.",
  certification: "Whether each certificate is real and current. Not part of the score.",
};

const PHOTO = {
  line: "/assets/dashboard-rfq-shirt.jpg",
  knit: "/assets/dashboard-rfq-knit.jpg",
  denim: "/assets/dashboard-rfq-denim.jpg",
  floor: "/assets/factory-header.png",
};

/* ---------- (a) China, original licence, QCC recorded ---------- */
const chinaOriginal = {
  id: "verify-cn-original",
  initials: "QJ",
  name: "Hangzhou Qianjiang Garment",
  entityType: "Factory",
  location: "Hangzhou, China",
  submitted: "2 hours ago",
  status: "Ready for review",
  tone: "info",
  owner: "Maya Chen",
  risk: "Low",
  evidence: "6 of 6 received",
  summary: "Woven shirt and outerwear factory with 4 sewing lines, exporting to the EU and US.",
  details: [["Year founded", "2015"], ["Team size", "140"], ["Website", "qjgarment.cn"], ["Primary market", "EU & North America"], ["Typical MOQ", "300 units / style"], ["Lead time", "30-35 days"]],
  capabilities: ["Wovens", "Shirts", "Outerwear", "OEKO-TEX"],
  checks: [],
  verification: {
    facts: [
      { label: "Terms signed", value: "Zhang Wei, Nov 9", ok: true },
      { label: "Registration uploaded", value: "business-licence.jpg", ok: true },
      { label: "Company details", value: "Complete", ok: true },
      { label: "Address", value: "18 Jiangdong 3rd Road, Xiaoshan, Hangzhou" },
      { label: "Company age", value: "11 years (licence: Apr 2015)" },
      { label: "Submitted by", value: "Zhang Wei · zhang@qjgarment.cn" },
    ],
    groups: [
      {
        key: "business_registration",
        label: "Business registration",
        verdict: "Original licence, found on QCC",
        why: "Every field on the licence is readable and matches the QCC record staff checked.",
        evidence: { kind: "licence", variant: "cn", file: "business-licence.jpg" },
        readAt: "Read Nov 11, 10:42",
        fields: [
          { key: "number", label: "Registration number", value: "91330109MA2B3K7Q4X" },
          { key: "established", label: "Established", value: "2015-04-16" },
          { key: "legalName", label: "Legal name", value: "杭州钱江服装有限公司" },
          { key: "representative", label: "Legal representative", value: "张伟 (Zhang Wei)" },
          { key: "legalNameEnglish", label: "Name in English", value: "Hangzhou Qianjiang Garment Co., Ltd.", wide: true },
          { key: "address", label: "Address", value: "杭州市萧山区江东三路18号", wide: true },
        ],
        checks: [
          { key: "licence", label: "Licence", weight: 30, score: 96, verdict: "Original, every field readable" },
          { key: "registry", label: "Official registry", weight: 30, score: 98, verdict: "Found on QCC, name and number match", registry: { source: "QCC", by: "Maya Chen, Nov 10", result: "found", reference: "qcc.com/firm/7a1c…" } },
        ],
      },
      {
        key: "company_information",
        label: "Company information",
        verdict: "Factory: licence includes garment making",
        why: "The licence lists garment manufacturing, the address is the licence's, and the photos are their own.",
        evidence: { kind: "photos", photos: [
          { src: PHOTO.floor, result: "own" }, { src: PHOTO.line, result: "own" }, { src: PHOTO.knit, result: "own" }, { src: PHOTO.denim, result: "unchecked" },
        ] },
        readAt: "Checked Nov 11, 10:44",
        fields: [
          { key: "scope", label: "Business scope on the licence", value: "服装制造；服装服饰批发；货物进出口", wide: true, multiline: true },
          { key: "siteAddress", label: "Factory address", value: "18 Jiangdong 3rd Road, Xiaoshan, Hangzhou", wide: true },
        ],
        checks: [
          { key: "scope", label: "Factory or trader", weight: 10, score: 100, verdict: "Makes garments (服装制造)" },
          { key: "address", label: "Address", weight: 15, score: 90, verdict: "Same as the licence, in an industrial area" },
          { key: "photos", label: "Photos", weight: 15, score: 85, verdict: "3 of 4 are their own, 1 not checked yet" },
        ],
      },
      {
        key: "certification",
        label: "Certification evidence",
        verdict: "OEKO-TEX certificate found, valid",
        why: "The certificate number is on the issuer's list under this company's name.",
        evidence: { kind: "certificate", name: "OEKO-TEX Standard 100", holder: "Hangzhou Qianjiang Garment Co., Ltd.", number: "SH025 187429", valid: "Mar 31, 2027" },
        readAt: "Checked Nov 11, 10:45",
        fields: [
          { key: "certNumber", label: "Certificate number", value: "SH025 187429" },
          { key: "validUntil", label: "Valid until", value: "2027-03-31" },
          { key: "holder", label: "Holder", value: "Hangzhou Qianjiang Garment Co., Ltd.", wide: true },
        ],
        checks: [
          { key: "certificate", label: "OEKO-TEX Standard 100", score: 92, verdict: "Found on the issuer's list, valid to Mar 2027", registry: { source: "Issuer's list", by: "Maya Chen, Nov 10", result: "found", reference: "" } },
        ],
      },
    ],
  },
};

/* ---------- (b) China, watermarked copy ---------- */
const chinaCopy = {
  id: "verify-cn-copy",
  initials: "YX",
  name: "Guangzhou Yuexiu Apparel",
  entityType: "Factory",
  location: "Guangzhou, China",
  submitted: "5 hours ago",
  status: "Ready for review",
  tone: "info",
  owner: "Unassigned",
  risk: "Not set",
  evidence: "6 of 6 received",
  summary: "Knit tops and jersey dresses, 2 lines, mainly private label for EU brands.",
  details: [["Year founded", "2018"], ["Team size", "65"], ["Website", "yxapparel.com"], ["Primary market", "EU"], ["Typical MOQ", "500 units / style"], ["Lead time", "25-30 days"]],
  capabilities: ["Knits", "Jersey", "Private label"],
  checks: [],
  verification: {
    facts: [
      { label: "Terms signed", value: "Li Na, Nov 10", ok: true },
      { label: "Registration uploaded", value: "licence-copy.jpg", ok: true },
      { label: "Company details", value: "Complete", ok: true },
      { label: "Address", value: "Building 3, 112 Huangpu Road, Baiyun, Guangzhou" },
      { label: "Company age", value: "8 years (licence: Jun 2018)" },
      { label: "Submitted by", value: "Li Na · lina@yxapparel.com" },
    ],
    groups: [
      {
        key: "business_registration",
        label: "Business registration",
        verdict: "Copy, not the original licence",
        why: "The image is stamped “仅供认证使用” (for verification use only). Ask for a photo of the original.",
        evidence: { kind: "licence", variant: "cn-copy", file: "licence-copy.jpg" },
        readAt: "Read Nov 12, 08:15",
        fields: [
          { key: "number", label: "Registration number", value: "91440111MA59C2RX8L" },
          { key: "established", label: "Established", value: "2018-06-02" },
          { key: "legalName", label: "Legal name", value: "广州越秀服饰有限公司" },
          { key: "representative", label: "Legal representative", value: "李娜 (Li Na)" },
          { key: "legalNameEnglish", label: "Name in English", value: "Guangzhou Yuexiu Apparel Co., Ltd.", wide: true },
          { key: "address", label: "Address", value: "广州市白云区黄浦路112号3栋", wide: true },
        ],
        checks: [
          { key: "licence", label: "Licence", weight: 30, score: 40, verdict: "Copy, not the original licence" },
          { key: "registry", label: "Official registry", weight: 30, score: 95, verdict: "Found on QCC, name and number match", registry: { source: "QCC", by: "Maya Chen, Nov 12", result: "found", reference: "qcc.com/firm/c93e…" } },
        ],
      },
      {
        key: "company_information",
        label: "Company information",
        verdict: "Factory: licence includes knitwear making",
        why: "The licence lists knitwear manufacturing; the address matches it.",
        evidence: { kind: "photos", photos: [
          { src: PHOTO.knit, result: "own" }, { src: PHOTO.floor, result: "own" }, { src: PHOTO.line, result: "unchecked" },
        ] },
        readAt: "Checked Nov 12, 08:16",
        fields: [
          { key: "scope", label: "Business scope on the licence", value: "针织服装制造；服装服饰零售", wide: true, multiline: true },
          { key: "siteAddress", label: "Factory address", value: "Building 3, 112 Huangpu Road, Baiyun, Guangzhou", wide: true },
        ],
        checks: [
          { key: "scope", label: "Factory or trader", weight: 10, score: 100, verdict: "Makes knitwear (针织服装制造)" },
          { key: "address", label: "Address", weight: 15, score: 85, verdict: "Same as the licence, in an industrial park" },
          { key: "photos", label: "Photos", weight: 15, score: 80, verdict: "2 of 3 are their own, 1 not checked yet" },
        ],
      },
      {
        key: "certification",
        label: "Certification evidence",
        verdict: "No certificate uploaded",
        why: "The company listed no certificates.",
        evidence: { kind: "none" },
        readAt: "",
        fields: [],
        checks: [{ key: "certificate", label: "Certificates", score: null, verdict: "None uploaded" }],
      },
    ],
  },
};

/* ---------- (c) Türkiye wholesaler ---------- */
const turkeyTrader = {
  id: "verify-tr-trader",
  initials: "MT",
  name: "Merter Tekstil",
  entityType: "Factory",
  location: "Istanbul, Türkiye",
  submitted: "Yesterday",
  status: "Ready for review",
  tone: "info",
  owner: "Unassigned",
  risk: "Not set",
  evidence: "5 of 6 received",
  summary: "Says it makes denim and woven trousers for European brands.",
  details: [["Year founded", "2020"], ["Team size", "300"], ["Website", "mertertekstil.com"], ["Primary market", "EU"], ["Typical MOQ", "200 units / style"], ["Lead time", "20 days"]],
  capabilities: ["Denim", "Trousers"],
  checks: [],
  verification: {
    facts: [
      { label: "Terms signed", value: "Emre Yılmaz, Nov 11", ok: true },
      { label: "Registration uploaded", value: "vergi-levhasi.pdf", ok: true },
      { label: "Company details", value: "Website and team size only", ok: false },
      { label: "Address", value: "Merter, Güngören, Istanbul" },
      { label: "Company age", value: "Not on the tax plate" },
      { label: "Submitted by", value: "Emre Yılmaz · emre@mertertekstil.com" },
    ],
    groups: [
      {
        key: "business_registration",
        label: "Business registration",
        verdict: "Tax plate read, registry not checked yet",
        why: "The tax number is valid. Look the company up in the Trade Registry Gazette and record what you find.",
        evidence: { kind: "licence", variant: "tr", file: "vergi-levhasi.pdf" },
        readAt: "Read Nov 11, 16:02",
        fields: [
          { key: "number", label: "Tax number (VKN)", value: "6230418795" },
          { key: "legalName", label: "Legal name", value: "Merter Tekstil Toptan Ticaret Ltd. Şti." },
          { key: "taxOffice", label: "Tax office", value: "Merter" },
          { key: "activity", label: "Main activity", value: "Toptan giyim ticareti" },
          { key: "address", label: "Address", value: "Merter Mah., Güngören, İstanbul", wide: true },
        ],
        checks: [
          { key: "licence", label: "Tax plate", weight: 30, score: 70, verdict: "Read, tax number valid" },
          { key: "registry", label: "Official registry", weight: 30, score: null, verdict: "Not checked yet", registry: { source: "Trade Registry Gazette", by: null, result: null, reference: "" } },
        ],
      },
      {
        key: "company_information",
        label: "Company information",
        verdict: "Wholesale trade only, no manufacturing",
        why: "The tax plate says “Toptan giyim ticareti” (wholesale of clothing). Two photos appear on other websites.",
        evidence: { kind: "photos", photos: [
          { src: PHOTO.denim, result: "elsewhere", where: "alibaba.com" }, { src: PHOTO.line, result: "elsewhere", where: "pinterest.com" }, { src: PHOTO.floor, result: "own" }, { src: PHOTO.knit, result: "unchecked" },
        ] },
        readAt: "Checked Nov 11, 16:03",
        fields: [
          { key: "scope", label: "Activity on the tax plate", value: "Toptan giyim ticareti (wholesale of clothing)", wide: true, multiline: true },
          { key: "siteAddress", label: "Factory address", value: "Merter, Güngören, Istanbul", wide: true },
        ],
        checks: [
          { key: "scope", label: "Factory or trader", weight: 10, score: 10, verdict: "Wholesale trade only, no manufacturing" },
          { key: "address", label: "Address", weight: 15, score: 30, verdict: "District only, no street or building" },
          { key: "photos", label: "Photos", weight: 15, score: 40, verdict: "2 of 4 found on other websites" },
        ],
      },
      {
        key: "certification",
        label: "Certification evidence",
        verdict: "No certificate uploaded",
        why: "The company listed no certificates.",
        evidence: { kind: "none" },
        readAt: "",
        fields: [],
        checks: [{ key: "certificate", label: "Certificates", score: null, verdict: "None uploaded" }],
      },
    ],
  },
};

/* ---------- (d) Portugal, EU VIES ---------- */
const PT_IMPROVED = {
  verdict: "Registered: name and VAT number match EU VIES",
  why: "With the full legal name, the certificate and EU VIES agree.",
  checks: [
    { key: "licence", label: "Registration certificate", weight: 30, score: 94, verdict: "Every field read, matches the registry" },
    { key: "registry", label: "Official registry", weight: 30, score: 95, verdict: "EU VIES: VAT number valid, name matches", registry: { source: "EU VIES", by: "Checked automatically", result: "found", reference: "PT513284976" } },
  ],
};

const portugalFactory = {
  id: "verify-pt-vies",
  initials: "TD",
  name: "Têxteis Douro",
  entityType: "Factory",
  location: "Barcelos, Portugal",
  submitted: "Yesterday",
  status: "Ready for review",
  tone: "info",
  owner: "Leo Park",
  risk: "Low",
  evidence: "6 of 6 received",
  summary: "Cut-and-sew jackets and overshirts in small batches, family run since 2012.",
  details: [["Year founded", "2012"], ["Team size", "38"], ["Website", "texteisdouro.pt"], ["Primary market", "EU"], ["Typical MOQ", "100 units / style"], ["Lead time", "28-35 days"]],
  capabilities: ["Outerwear", "Cut & sew", "Small batch"],
  checks: [],
  verification: {
    facts: [
      { label: "Terms signed", value: "Rui Ferreira, Nov 10", ok: true },
      { label: "Registration uploaded", value: "certidao-permanente.pdf", ok: true },
      { label: "Company details", value: "Complete", ok: true },
      { label: "Address", value: "Rua da Igreja 214, Arcozelo, Barcelos" },
      { label: "Company age", value: "14 years (certificate: Mar 2012)" },
      { label: "Submitted by", value: "Rui Ferreira · rui@texteisdouro.pt" },
    ],
    groups: [
      {
        key: "business_registration",
        label: "Business registration",
        verdict: "Registered, but the name only partly matches",
        why: "EU VIES has “Têxteis Douro – Confecções, Lda”; the name read from the certificate is shorter.",
        evidence: { kind: "licence", variant: "pt", file: "certidao-permanente.pdf" },
        readAt: "Read Nov 11, 14:20",
        fields: [
          { key: "number", label: "NIPC (company number)", value: "513284976" },
          { key: "legalName", label: "Legal name", value: "Têxteis Douro, Lda" },
          { key: "established", label: "Registered", value: "2012-03-08" },
          { key: "activity", label: "Activity code (CAE)", value: "14130 · Other outerwear" },
          { key: "address", label: "Registered address", value: "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos", wide: true },
        ],
        checks: [
          { key: "licence", label: "Registration certificate", weight: 30, score: 70, verdict: "Read; legal name looks cut short" },
          { key: "registry", label: "Official registry", weight: 30, score: 80, verdict: "EU VIES: VAT number valid, name partly matches", registry: { source: "EU VIES", by: "Checked automatically", result: "found", reference: "PT513284976" } },
        ],
        // What "Run again" gives once the legal name has been corrected.
        rerun: (fields) => (/confec/i.test(fields.legalName ?? "") ? PT_IMPROVED : null),
      },
      {
        key: "company_information",
        label: "Company information",
        verdict: "Factory, but the address looks like a home",
        why: "The activity code is garment making. The address matches the certificate but sits in a residential street.",
        evidence: { kind: "photos", photos: [
          { src: PHOTO.line, result: "own" }, { src: PHOTO.floor, result: "unchecked" }, { src: PHOTO.denim, result: "unchecked" },
        ] },
        readAt: "Checked Nov 11, 14:21",
        fields: [
          { key: "scope", label: "Activity on the certificate", value: "CAE 14130 · Manufacture of other outerwear", wide: true, multiline: true },
          { key: "siteAddress", label: "Factory address", value: "Rua da Igreja 214, Arcozelo, Barcelos", wide: true },
        ],
        checks: [
          { key: "scope", label: "Factory or trader", weight: 10, score: 100, verdict: "Makes outerwear (CAE 14130)" },
          { key: "address", label: "Address", weight: 15, score: 55, verdict: "Looks like a home, not a factory site" },
          { key: "photos", label: "Photos", weight: 15, score: 60, verdict: "1 of 3 checked: their own" },
        ],
      },
      {
        key: "certification",
        label: "Certification evidence",
        verdict: "GOTS certificate, scope to confirm",
        why: "Found on the issuer's list; the scope covers dyeing, not cut-and-sew.",
        evidence: { kind: "certificate", name: "GOTS", holder: "Têxteis Douro – Confecções, Lda", number: "CU 1048211", valid: "Aug 31, 2027" },
        readAt: "Checked Nov 11, 14:22",
        fields: [
          { key: "certNumber", label: "Certificate number", value: "CU 1048211" },
          { key: "validUntil", label: "Valid until", value: "2027-08-31" },
          { key: "holder", label: "Holder", value: "Têxteis Douro – Confecções, Lda", wide: true },
        ],
        checks: [
          { key: "certificate", label: "GOTS", score: 72, verdict: "Valid, but the scope doesn't cover cut-and-sew", registry: { source: "Issuer's list", by: "Leo Park, Nov 11", result: "found", reference: "" } },
        ],
      },
    ],
  },
};

function withScore(profile) {
  const overall = scoreOverall(profile.verification.groups);
  return { ...profile, confidence: overall, confidenceLabel: "Score" };
}

export const verificationMockProfiles = [chinaOriginal, chinaCopy, turkeyTrader, portugalFactory].map(withScore);
