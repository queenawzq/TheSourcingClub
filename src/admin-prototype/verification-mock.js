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


import { scoreOverall, withPhotoCheck } from "./verification-scoring.js";

export * from "./verification-scoring.js";

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
          { key: "number", label: "Registration number", value: "91330109MA2B3K7Q4X", copy: true },
          { key: "established", label: "Established", value: "2015-04-16" },
          { key: "legalName", label: "Legal name", value: "杭州钱江服装有限公司" },
          { key: "representative", label: "Legal representative", value: "张伟 (Zhang Wei)" },
          { key: "legalNameEnglish", label: "Name in English", value: "Hangzhou Qianjiang Garment Co., Ltd.", wide: true },
          { key: "address", label: "Address", value: "杭州市萧山区江东三路18号", wide: true },
        ],
        checks: [
          { key: "licence", label: "Licence", weight: 30, score: 96, verdict: "Original, every field readable" },
          { key: "registry", label: "Official registry", kind: "registry", weight: 30, score: 98, verdict: "Found on QCC, name and number match", registry: { source: "QCC", by: "Maya Chen, Nov 10", result: "found", reference: "qcc.com/firm/7a1c…", name: "杭州钱江服装有限公司" }, lookup: { label: "Open QCC", href: "https://www.qcc.com/web/search?key=91330109MA2B3K7Q4X", copy: "91330109MA2B3K7Q4X" } },
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
          { key: "address", label: "Address", weight: 15, score: 90, verdict: "Same as the licence, in an industrial area", lookup: { label: "Open map", href: "https://www.google.com/maps/search/?api=1&query=18%20Jiangdong%203rd%20Road%2C%20Xiaoshan%2C%20Hangzhou" } },
          { key: "photos", label: "Photos", weight: 15 },
        ],
      },
      {
        key: "certification",
        label: "Certification evidence",
        verdict: "OEKO-TEX certificate found, valid",
        why: "The certificate number is on the issuer's list under this company's name.",
        evidence: { kind: "certificate", fileName: "certificate.pdf", name: "OEKO-TEX Standard 100", holder: "Hangzhou Qianjiang Garment Co., Ltd.", number: "SH025 187429", valid: "Mar 31, 2027" },
        readAt: "Checked Nov 11, 10:45",
        fields: [
          { key: "certNumber", label: "Certificate number", value: "SH025 187429", copy: true },
          { key: "validUntil", label: "Valid until", value: "2027-03-31" },
          { key: "holder", label: "Holder", value: "Hangzhou Qianjiang Garment Co., Ltd.", wide: true },
        ],
        checks: [
          { key: "certificate", label: "OEKO-TEX Standard 100", kind: "certificate", score: 92, verdict: "Found on the issuer's list, valid to Mar 2027", registry: { source: "Issuer's list", by: "Maya Chen, Nov 10", result: "found", reference: "" }, lookup: { label: "Open issuer's list", href: "https://www.oeko-tex.com/en/label-check" } },
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
      { label: "Address", value: "Building 5, 112 Huangpu Road, Baiyun, Guangzhou" },
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
          { key: "number", label: "Registration number", value: "91440111MA59C2RX8L", copy: true, typed: "91440111MA59C2RX8J" },
          { key: "established", label: "Established", value: "2018-06-02" },
          { key: "legalName", label: "Legal name", value: "广州越秀服饰有限公司" },
          { key: "representative", label: "Legal representative", value: "李娜 (Li Na)" },
          { key: "legalNameEnglish", label: "Name in English", value: "Guangzhou Yuexiu Apparel Co., Ltd.", wide: true },
          { key: "address", label: "Address", value: "广州市白云区黄浦路112号3栋", wide: true },
        ],
        checks: [
          { key: "licence", label: "Licence", weight: 30, score: 40, verdict: "Copy, not the original licence" },
          { key: "registry", label: "Official registry", kind: "registry", weight: 30, score: 95, verdict: "Found on QCC, name and number match", registry: { source: "QCC", by: "Maya Chen, Nov 12", result: "found", reference: "qcc.com/firm/c93e…", name: "广州越秀服饰有限公司" }, lookup: { label: "Open QCC", href: "https://www.qcc.com/web/search?key=91440111MA59C2RX8L", copy: "91440111MA59C2RX8L" } },
        ],
      },
      {
        key: "company_information",
        label: "Company information",
        verdict: "Factory, at a different building from the licence",
        why: "The licence lists knitwear manufacturing; the factory address is Building 5, the licence says Building 3.",
        evidence: { kind: "photos", photos: [
          { src: PHOTO.knit, result: "own" }, { src: PHOTO.floor, result: "own" }, { src: PHOTO.line, result: "unchecked" },
        ] },
        readAt: "Checked Nov 12, 08:16",
        fields: [
          { key: "scope", label: "Business scope on the licence", value: "针织服装制造；服装服饰零售", wide: true, multiline: true },
          { key: "siteAddress", label: "Factory address", value: "Building 5, 112 Huangpu Road, Baiyun, Guangzhou", wide: true, licence: "Building 3, 112 Huangpu Road, Baiyun, Guangzhou" },
        ],
        checks: [
          { key: "scope", label: "Factory or trader", weight: 10, score: 100, verdict: "Makes knitwear (针织服装制造)" },
          { key: "address", label: "Address", weight: 15, score: 70, verdict: "Building differs from the licence", lookup: { label: "Open map", href: "https://www.google.com/maps/search/?api=1&query=112%20Huangpu%20Road%2C%20Baiyun%2C%20Guangzhou" } },
          { key: "photos", label: "Photos", weight: 15 },
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
        verdict: "Renamed since the registry check",
        why: "GİB was checked for “Merter Tekstil Ltd. Şti.”; the name is now longer, and Merter Denim uses the same tax number.",
        evidence: { kind: "licence", variant: "tr", file: "vergi-levhasi.pdf" },
        readAt: "Read Nov 11, 16:02",
        fields: [
          { key: "number", label: "Tax number (VKN)", value: "6230418795", copy: true, wide: true, duplicate: { with: "Merter Denim", explained: null } },
          { key: "letter", label: "Letter number", value: "2026-GIB-0451887", copy: true },
          { key: "taxOffice", label: "Tax office", value: "Merter" },
          { key: "legalName", label: "Legal name", value: "Merter Tekstil Toptan Ticaret Ltd. Şti.", wide: true },
          { key: "activity", label: "Main activity", value: "Toptan giyim ticareti" },
          { key: "address", label: "Address", value: "Merter Mah., Güngören, İstanbul" },
        ],
        checks: [
          { key: "licence", label: "Tax plate", weight: 30, score: 70, verdict: "Read, tax number valid" },
          { key: "registry", label: "Official registry", kind: "registry", weight: 30, score: null, verdict: "Renamed since the check", registry: { source: "GİB", by: "Leo Park, Nov 4", for: "Merter Tekstil Ltd. Şti.", result: "found", reference: "", name: "Merter Tekstil Ltd. Şti." }, lookup: { label: "Open GİB", href: "https://ivd.gib.gov.tr/", copy: "6230418795" } },
        ],
      },
      {
        key: "company_information",
        label: "Company information",
        verdict: "Wholesale trade only, no manufacturing",
        why: "The tax plate says “Toptan giyim ticareti” (wholesale of clothing), and no photo shows their own factory.",
        evidence: { kind: "photos", photos: [
          { src: PHOTO.denim, result: "elsewhere", where: "alibaba.com" },
          { src: PHOTO.line, result: "unchecked", flag: "stock" },
          { src: PHOTO.floor, result: "unchecked", flag: "tsc", others: 2 },
          { src: PHOTO.knit, result: "own", flag: "office" },
        ] },
        readAt: "Checked Nov 11, 16:03",
        fields: [
          { key: "scope", label: "Activity on the tax plate", value: "Toptan giyim ticareti (wholesale of clothing)", wide: true, multiline: true },
          { key: "siteAddress", label: "Factory address", value: "Merter, Güngören, Istanbul", wide: true },
        ],
        checks: [
          { key: "scope", label: "Factory or trader", weight: 10, score: 10, verdict: "Wholesale trade only, no manufacturing" },
          { key: "address", label: "Address", weight: 15, score: 30, verdict: "District only, no street or building", lookup: { label: "Open map", href: "https://www.google.com/maps/search/?api=1&query=Merter%2C%20G%C3%BCng%C3%B6ren%2C%20Istanbul" } },
          { key: "photos", label: "Photos", weight: 15 },
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
const PT_FULL_NAME = "Têxteis Douro – Confecções, Lda";
const PT_IMPROVED = {
  verdict: "Registered: name and VAT number match EU VIES",
  why: "The current certificate and EU VIES agree on the full legal name.",
  checks: [
    { key: "licence", label: "Registration certificate", weight: 30, score: 94, verdict: "Every field read, matches the registry", lookup: { label: "Open online certificate", href: "https://www2.gov.pt/en/servicos/consultar-uma-certidao-permanente", copy: "4821-7730-9145" } },
    { key: "registry", label: "Official registry", kind: "registry", weight: 30, score: 95, verdict: "EU VIES: VAT number valid, name matches", registry: { source: "EU VIES", by: "Checked automatically", result: "found", reference: "PT513284976" }, lookup: { label: "Open EU VIES", href: "https://ec.europa.eu/taxation_customs/vies/", copy: "513284976" } },
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
        evidence: { kind: "licence", files: [
          { variant: "pt", file: "certidao-permanente.pdf", when: "Nov 11" },
          { variant: "pt-old", file: "certidao-2023.pdf", when: "Nov 9" },
        ] },
        readAt: "Read Nov 9, 18:05",
        stale: "Read from an earlier upload, Nov 9",
        fields: [
          { key: "number", label: "NIPC (company number)", value: "513284976", copy: true },
          { key: "accessCode", label: "Access code", value: "4821-7730-9145", copy: true },
          { key: "legalName", label: "Legal name", value: "Têxteis Douro, Lda" },
          { key: "established", label: "Registered", value: "2012-03-08" },
          { key: "activity", label: "Activity code (CAE)", value: "14130 · Other outerwear", wide: true },
          { key: "address", label: "Registered address", value: "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos", wide: true },
        ],
        checks: [
          { key: "licence", label: "Registration certificate", weight: 30, score: 70, verdict: "Read; legal name looks cut short", lookup: { label: "Open online certificate", href: "https://www2.gov.pt/en/servicos/consultar-uma-certidao-permanente", copy: "4821-7730-9145" } },
          { key: "registry", label: "Official registry", kind: "registry", weight: 30, score: 80, verdict: "EU VIES: VAT number valid, name partly matches", registry: { source: "EU VIES", by: "Checked automatically", result: "found", reference: "PT513284976" }, lookup: { label: "Open EU VIES", href: "https://ec.europa.eu/taxation_customs/vies/", copy: "513284976" } },
        ],
        // Run again reads the current upload (or takes the corrected name) and asks EU VIES again.
        rerun: (values, group) => (group.stale || /confec/i.test(values.legalName ?? "")
          ? { ...PT_IMPROVED, values: { legalName: /confec/i.test(values.legalName ?? "") ? values.legalName : PT_FULL_NAME } }
          : null),
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
          { key: "address", label: "Address", weight: 15, score: 55, verdict: "Looks like a home, not a factory site", lookup: { label: "Open map", href: "https://www.google.com/maps/search/?api=1&query=Rua%20da%20Igreja%20214%2C%20Arcozelo%2C%20Barcelos" } },
          { key: "photos", label: "Photos", weight: 15 },
        ],
        // The map finds the street only with its postcode: a failed run says so.
        rerun: (values) => (/\d{4}-\d{3}/.test(values.siteAddress ?? "") ? null : { error: "Address not found on the map. Add the postcode." }),
      },
      {
        key: "certification",
        label: "Certification evidence",
        verdict: "GOTS certificate, scope to confirm",
        why: "Found on the issuer's list; the scope covers dyeing, not cut-and-sew.",
        evidence: { kind: "certificate", fileName: "certificate.pdf", name: "GOTS", holder: "Têxteis Douro – Confecções, Lda", number: "CU 1048211", valid: "Aug 31, 2027" },
        readAt: "Checked Nov 11, 14:22",
        checkingMs: 3500,
        fields: [
          { key: "certNumber", label: "Certificate number", value: "CU 1048211", copy: true },
          { key: "validUntil", label: "Valid until", value: "2027-08-31" },
          { key: "holder", label: "Holder", value: "Têxteis Douro – Confecções, Lda", wide: true },
        ],
        checks: [
          { key: "certificate", label: "GOTS", kind: "certificate", score: 72, verdict: "Valid, but the scope doesn't cover cut-and-sew", registry: { source: "Issuer's list", by: "Leo Park, Nov 11", result: "found", reference: "" }, lookup: { label: "Open issuer's list", href: "https://global-standard.org/find-suppliers-shops-and-inputs/certified-suppliers" }, reason: { text: "Dyeing is subcontracted; cut-and-sew is done in their own unit (seen on the video call).", by: "Leo Park, Nov 11" } },
        ],
      },
    ],
  },
};

/** The Photos check is worked out from the tiles, so the mock and a staff record agree. */

function withScore(profile) {
  const groups = profile.verification.groups.map(withPhotoCheck);
  const overall = scoreOverall(groups);
  return { ...profile, verification: { ...profile.verification, groups }, confidence: overall, confidenceLabel: "Score" };
}

export const verificationMockProfiles = [chinaOriginal, chinaCopy, turkeyTrader, portugalFactory].map(withScore);
