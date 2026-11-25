/**
 * The registration documents and certificates behind the four verification
 * demo cases (scripts/seed-demo.mjs, "verification score cases").
 *
 *   node scripts/make-demo-verification-docs.mjs
 *
 * Drawn as HTML and rendered to PNG by headless Chrome, into
 * assets/demo-verification/. The companies, people, addresses and numbers are
 * the seed's invented ones (numbers with valid check digits), so the AI
 * reading of each image gives back what the seed records and Run again with
 * nothing edited returns the same result. Layouts are plain sketches of each
 * country's document, with no state emblem and no authority seal: they are
 * demo fixtures, not copies of an official form.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "scripts", "demo-verification-docs");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-demo-docs-"));
const CHROME = process.env.CHROME_PATH
  ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome found; set CHROME_PATH.");

// `node scripts/make-demo-verification-docs.mjs gb-certificate.png …` renders only the files named.
const ONLY = process.argv.slice(2);

function render(name, html, size) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const file = path.join(SCRATCH, `${name}.html`);
  fs.writeFileSync(file, html);
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(SCRATCH, "profile")}`, `--screenshot=${path.join(OUT, name)}`, `--window-size=${size}`, `file://${file}`,
  ], { stdio: "ignore" });
  console.log(`  ${name}`);
}

/* ------------------------------------------------------------ China: 营业执照 */

function chinaLicence(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#f4efe4;font-family:"Songti SC","STSong","SimSun",serif;color:#222}
  .sheet{position:relative;width:1400px;height:1000px;box-sizing:border-box;border:22px double #b8862e;padding:46px 70px;background:#fbf7ee;overflow:hidden}
  h1{font-size:76px;letter-spacing:40px;text-align:center;margin:6px 0 4px;font-weight:700}
  .dup{text-align:center;font-size:22px;margin-bottom:24px}
  .top{display:flex;justify-content:space-between;font-size:24px;margin-bottom:26px}
  .qr{width:120px;height:120px;background:repeating-linear-gradient(90deg,#222 0 6px,#fff 6px 12px),#fff;opacity:.85}
  table{width:100%;font-size:26px;border-collapse:collapse}
  td{padding:9px 6px;vertical-align:top}
  td.k{width:150px;letter-spacing:6px;white-space:nowrap}
  .cols{display:flex;gap:40px}.cols table{flex:1}
  .foot{position:absolute;right:90px;bottom:70px;text-align:right;font-size:24px;line-height:1.6}
  .mark{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);align-content:space-around;pointer-events:none}
  .mark span{transform:rotate(-24deg);font:700 34px/1.3 "PingFang SC",Arial,sans-serif;color:rgba(40,70,160,.30);text-align:center;white-space:nowrap}
  </style></head><body><div class="sheet">
  <h1>营业执照</h1><div class="dup">（副　本）</div>
  <div class="top"><div>统一社会信用代码<br><b style="font-size:30px;letter-spacing:2px">${d.code}</b></div><div class="qr"></div></div>
  <div class="cols"><table>
    <tr><td class="k">名　　称</td><td>${d.name}</td></tr>
    <tr><td class="k">类　　型</td><td>有限责任公司（自然人投资或控股）</td></tr>
    <tr><td class="k">法定代表人</td><td>${d.rep}</td></tr>
    <tr><td class="k">经营范围</td><td>${d.scope}</td></tr>
  </table><table style="max-width:540px">
    <tr><td class="k">注册资本</td><td>${d.capital}</td></tr>
    <tr><td class="k">成立日期</td><td>${d.founded}</td></tr>
    <tr><td class="k">营业期限</td><td>${d.founded}至长期</td></tr>
    <tr><td class="k">住　　所</td><td>${d.address}</td></tr>
  </table></div>
  <div class="foot">${d.authority}<br>${d.issued}</div>
  ${d.watermark ? `<div class="mark">${Array.from({ length: 9 }, () => `<span>${d.watermark}</span>`).join("")}</div>` : ""}
  </div></body></html>`;
}

/* ------------------------------------------------------------ Türkiye: vergi levhası */

function turkeyPlate(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111}
  .sheet{position:relative;width:1240px;height:860px;box-sizing:border-box;border:3px solid #333;padding:36px 50px}
  .hdr{border-bottom:3px solid #333;padding-bottom:14px;text-align:center}
  .hdr h1{font-size:30px;margin:0;line-height:1.3}
  table{width:100%;border-collapse:collapse;margin-top:20px;font-size:21px}
  td{border:1px solid #555;padding:10px 12px;vertical-align:top}td.k{width:330px;font-weight:700;background:#f1f1f1}
  .years td{text-align:center}
  .foot{margin-top:18px;font-size:16px;color:#333}
  </style></head><body><div class="sheet">
  <div class="hdr"><h1>VERGİ LEVHASI</h1></div>
  <table>
    <tr><td class="k">ADI SOYADI / TİCARET ÜNVANI</td><td>${d.name}</td></tr>
    <tr><td class="k">İŞ YERİ ADRESİ</td><td>${d.address}</td></tr>
    <tr><td class="k">VERGİ TÜRÜ</td><td>KURUMLAR VERGİSİ</td></tr>
    <tr><td class="k">VERGİ DAİRESİ</td><td>${d.office}</td></tr>
    <tr><td class="k">VERGİ KİMLİK NO</td><td><b>${d.vkn}</b></td></tr>
    <tr><td class="k">ANA FAALİYET KODU VE ADI</td><td>${d.activity}</td></tr>
  </table>
  <table class="years"><tr><td class="k">TAKVİM YILI</td><td>2023</td><td>2024</td><td>2025</td></tr>
  <tr><td class="k">BEYAN EDİLEN MATRAH</td><td>3.218.400,00</td><td>4.006.150,00</td><td>4.977.020,00</td></tr></table>
  <div class="foot">Onay Kodu: ${d.approval}</div>
  </div></body></html>`;
}

/* ------------------------------------------------------------ Portugal: certidão permanente */

function portugalCertidao(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:"Times New Roman",serif;color:#111;font-size:22px}
  .sheet{position:relative;width:1100px;height:1400px;box-sizing:border-box;padding:60px 70px}
  .hdr{border-bottom:2px solid #0b4f2f;padding-bottom:10px;margin-bottom:16px}
  .hdr b{font-size:26px;color:#0b4f2f}
  h1{font-size:32px;text-align:center;margin:20px 0}
  .sec{font-weight:700;margin-top:22px;border-bottom:1px solid #999}
  p{margin:8px 0;line-height:1.45}
  </style></head><body><div class="sheet">
  <div class="hdr"><b>Registo Comercial</b></div>
  <h1>CERTIDÃO PERMANENTE</h1>
  <p>Código de acesso: ${d.access} &nbsp;&nbsp; Subscrita em: ${d.subscribed}</p>
  <div class="sec">MATRÍCULA</div>
  <p>NIPC: <b>${d.nipc}</b></p>
  <p>Firma: <b>${d.name}</b></p>
  <p>Natureza Jurídica: SOCIEDADE POR QUOTAS</p>
  <p>Sede: ${d.address}</p>
  <p>Objeto: Confeção de vestuário exterior em série; corte e costura de casacos e sobrecamisas.</p>
  <p>CAE Principal: 14130-R3</p>
  <p>Capital: 25.000,00 Euros</p>
  <div class="sec">INSCRIÇÕES — AVERBAMENTOS — ANOTAÇÕES</div>
  <p>Insc.1 AP. 7/20120308 — CONTRATO DE SOCIEDADE E DESIGNAÇÃO DE MEMBRO(S) DE ÓRGÃO(S) SOCIAL(AIS)</p>
  <p>Data do contrato: 2012-03-08</p>
  <p>GERÊNCIA: Rui Manuel Ferreira</p>
  <p>Forma de obrigar: Com a assinatura de um gerente.</p>
  ${d.extra ?? ""}
  </div></body></html>`;
}

/* ------------------------------------------------------------ other countries: one plain extract */

// A plain register extract or certificate of incorporation, in the country's own words (fix round, Nov 24:
// demo factories from eight more countries). No emblem, no seal: a demo fixture, not an official form.
function registerExtract(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:Georgia,"Times New Roman",serif;color:#111}
  .sheet{position:relative;width:1100px;height:1300px;box-sizing:border-box;border:2px solid #444;padding:70px 80px}
  .hdr{text-align:center;border-bottom:2px solid #444;padding-bottom:18px;margin-bottom:34px}
  .hdr small{display:block;font-size:20px;letter-spacing:2px;text-transform:uppercase;color:#333}
  .hdr h1{font-size:38px;margin:14px 0 6px}
  .hdr p{margin:0;font-size:20px;color:#333}
  table{width:100%;border-collapse:collapse;font-size:23px}
  td{border-bottom:1px solid #bbb;padding:14px 10px;vertical-align:top}td.k{width:360px;color:#333}
  .body{font-size:22px;line-height:1.6;margin-top:34px}
  .foot{position:absolute;left:80px;right:80px;bottom:60px;font-size:18px;color:#444;display:flex;justify-content:space-between}
  </style></head><body><div class="sheet">
  <div class="hdr"><small>${d.authority}</small><h1>${d.title}</h1>${d.subtitle ? `<p>${d.subtitle}</p>` : ""}</div>
  <table>${d.rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join("")}</table>
  ${d.body ? `<div class="body">${d.body}</div>` : ""}
  <div class="foot"><span>${d.issued}</span><span>${d.reference ?? ""}</span></div>
  </div></body></html>`;
}

/* ------------------------------------------------------------ certificates */

function certificate(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#eef2f0;font-family:Georgia,"Times New Roman",serif;color:#1d2b24}
  .sheet{position:relative;width:1400px;height:990px;box-sizing:border-box;margin:0;border:16px solid #2f6b55;padding:70px 90px;background:#fff}
  h1{font-size:64px;letter-spacing:8px;text-align:center;margin:10px 0 6px}
  .std{text-align:center;font-size:30px;margin-bottom:46px;color:#2f6b55}
  table{width:100%;font-size:28px;border-collapse:collapse}
  td{padding:12px 6px;vertical-align:top}td.k{width:330px;color:#55665e}
  .foot{position:absolute;left:90px;right:90px;bottom:60px;display:flex;justify-content:space-between;font-size:22px;color:#55665e}
  </style></head><body><div class="sheet">
  <h1>CERTIFICATE</h1><div class="std">${d.standard}</div>
  <table>
    <tr><td class="k">Certificate number</td><td><b>${d.number}</b></td></tr>
    <tr><td class="k">Certificate holder</td><td>${d.holder}</td></tr>
    <tr><td class="k">Address</td><td>${d.address}</td></tr>
    <tr><td class="k">Scope</td><td>${d.scope}</td></tr>
    <tr><td class="k">Issued</td><td>${d.issued}</td></tr>
    <tr><td class="k">Valid until</td><td><b>${d.valid}</b></td></tr>
  </table>
  <div class="foot"><span>${d.issuer}</span><span>Check this certificate on the issuer's list with its number.</span></div>
  </div></body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
console.log("demo verification documents → scripts/demo-verification-docs/");

// A: China, the original licence (the seed's reading is what it shows).
render("cn-original-licence.png", chinaLicence({
  code: "91330109MA2B3K7Q4L", name: "杭州钱江服装有限公司", rep: "张伟", scope: "服装制造；服装服饰批发；货物进出口",
  capital: "伍佰万元整", founded: "2015年04月16日", address: "杭州市萧山区江东三路18号",
  authority: "杭州市萧山区市场监督管理局", issued: "2024年05月20日",
}), "1400,1000");

// B: China, a copy with the factory's own "for verification use only" watermark across it.
render("cn-copy-licence.png", chinaLicence({
  code: "91440111MA59C2RX8B", name: "广州越秀服饰有限公司", rep: "李娜", scope: "针织服装制造；服装服饰零售",
  capital: "叁佰万元整", founded: "2018年06月02日", address: "广州市白云区黄浦路112号3栋",
  authority: "广州市白云区市场监督管理局", issued: "2023年09月11日",
  watermark: "仅供认证使用 / for verification use only",
}), "1400,1000");

// C: Türkiye, the wholesaler's vergi levhası, under its current (longer) name.
render("tr-vergi-levhasi.png", turkeyPlate({
  name: "MERTER TEKSTİL TOPTAN TİCARET LTD. ŞTİ.", address: "Merter Mah., Güngören, İstanbul", office: "MERTER",
  vkn: "6230418796", activity: "46.42 — Giyim eşyası toptan ticareti (Toptan giyim ticareti)", approval: "2026GIB0451887",
}), "1240,860");

// D: Portugal, the 2023 certidão under the old, shorter name, and the current one.
render("pt-certidao-2023.png", portugalCertidao({
  access: "4821-7730-9145", subscribed: "2023-02-14", nipc: "513284974", name: "TÊXTEIS DOURO, LDA",
  address: "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos",
}), "1100,1400");
render("pt-certidao-permanente.png", portugalCertidao({
  access: "4821-7730-9145", subscribed: "2026-11-02", nipc: "513284974", name: "TÊXTEIS DOURO – CONFECÇÕES, LDA",
  address: "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos",
  extra: "<p>Insc.4 AP. 3/20250917 — ALTERAÇÃO DA FIRMA: TÊXTEIS DOURO – CONFECÇÕES, LDA</p>",
}), "1100,1400");

// Certificates: A's OEKO-TEX and D's GOTS (staff found both on the issuer's list).
render("cn-certificate-oeko-tex.png", certificate({
  standard: "OEKO-TEX Standard 100", number: "SH025 187429", holder: "杭州钱江服装有限公司 · Hangzhou Qianjiang Garment Co., Ltd.",
  address: "杭州市萧山区江东三路18号", scope: "Woven shirts and outerwear, adults and children (product class II)",
  issued: "2026-03-31", valid: "2027-03-31", issuer: "Eastern Textile Testing Laboratory",
}), "1400,990");
render("pt-certificate-gots.png", certificate({
  standard: "Global Organic Textile Standard (GOTS)", number: "CU 1048211", holder: "Têxteis Douro – Confecções, Lda",
  address: "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos", scope: "Cutting, sewing and packing of organic cotton jackets and overshirts",
  issued: "2026-08-31", valid: "2027-08-31", issuer: "Northern Textile Certification",
}), "1400,990");

// The waiting-for-review factories of eight more countries (seed: "eight more countries").
render("es-nota-simple.png", registerExtract({
  authority: "Registro Mercantil de Alicante", title: "Nota simple informativa", subtitle: "Información mercantil de sociedad",
  rows: [["Denominación social", "CONFECCIONES LEVANTE, S.L."], ["CIF", "<b>B54839216</b>"], ["Domicilio social", "Calle Severo Ochoa 18, Polígono Industrial Carrús, 03205 Elche, Alicante"],
    ["Fecha de constitución", "12/05/2011"], ["Objeto social", "Confección de prendas de vestir exteriores; fabricación de prendas de punto"], ["Inscripción", "Tomo 3482, Folio 117, Hoja A-128734"]],
  issued: "Expedida el 03/11/2026", reference: "Ref. NS-2026-118423",
}), "1100,1300");
render("gb-certificate.png", registerExtract({
  authority: "Companies House", title: "Certificate of Incorporation of a Private Limited Company", subtitle: "Company Number <b>14827365</b>",
  rows: [["Company name", "PENNINE KNITWEAR LTD"], ["Company number", "<b>14827365</b>"], ["Registered office", "Unit 4, Abbey Meadows Mills, Abbey Lane, Leicester LE4 5DQ"],
    ["Incorporated on", "18 April 2023"], ["Type", "Private company limited by shares"], ["Nature of business (SIC)", "14390 Manufacture of other knitted and crocheted apparel"]],
  body: "The Registrar of Companies for England and Wales hereby certifies that PENNINE KNITWEAR LTD is this day incorporated under the Companies Act 2006 as a private company, that the company is limited by shares, and the situation of its registered office is in England and Wales.",
  issued: "Given at Companies House, Cardiff, on 18 April 2023",
}), "1100,1300");
render("it-visura.png", registerExtract({
  authority: "Camera di Commercio di Bergamo · Registro delle Imprese", title: "Visura ordinaria società di capitale", subtitle: "Informazioni presenti nel Registro delle Imprese",
  rows: [["Denominazione", "MAGLIFICIO VAL SERIANA S.R.L."], ["Codice fiscale e n. iscrizione", "<b>04812730165</b>"], ["Numero REA", "BG - 489217"],
    ["Sede legale", "Via Provinciale 62, 24021 Albino (BG)"], ["Data di costituzione", "09/02/2009"], ["Attività", "Fabbricazione di articoli di maglieria (ATECO 14.39)"]],
  issued: "Documento n. T 512847301 estratto il 05/11/2026",
}), "1100,1300");
render("vn-dkkd.png", registerExtract({
  authority: "Sở Kế hoạch và Đầu tư Thành phố Hà Nội · Phòng Đăng ký kinh doanh", title: "Giấy chứng nhận đăng ký doanh nghiệp", subtitle: "Công ty trách nhiệm hữu hạn hai thành viên trở lên",
  rows: [["Tên công ty", "CÔNG TY TNHH MAY MẶC SÔNG HỒNG"], ["Tên viết bằng tiếng nước ngoài", "SONG HONG GARMENT COMPANY LIMITED"], ["Mã số doanh nghiệp", "<b>0108472915</b>"],
    ["Địa chỉ trụ sở chính", "Lô CN3, Khu công nghiệp Quang Minh, Huyện Mê Linh, Hà Nội"], ["Đăng ký lần đầu", "ngày 14 tháng 09 năm 2018"], ["Ngành nghề", "1410 May trang phục (trừ trang phục từ da lông thú)"]],
  issued: "Đăng ký thay đổi lần thứ 3: ngày 22 tháng 03 năm 2025",
}), "1100,1300");
render("in-incorporation.png", registerExtract({
  authority: "Government of India · Ministry of Corporate Affairs · Registrar of Companies, Chennai", title: "Certificate of Incorporation", subtitle: "[Pursuant to sub-section (2) of section 7 of the Companies Act, 2013]",
  rows: [["Company name", "TIRUPPUR KNIT EXPORTS PRIVATE LIMITED"], ["Corporate Identity Number (CIN)", "<b>U18101TZ2015PTC021847</b>"], ["Registered office", "14/2 Kangeyam Road, Veerapandi, Tiruppur, Tamil Nadu 641605"],
    ["Date of incorporation", "21 July 2015"], ["Class", "Private company limited by shares"], ["Main activity", "Manufacture of knitted and crocheted apparel"]],
  issued: "Given under my hand at Chennai this 21st day of July 2015", reference: "SRN G21847315",
}), "1100,1300");
render("bd-incorporation.png", registerExtract({
  authority: "Office of the Registrar of Joint Stock Companies and Firms, Dhaka", title: "Certificate of Incorporation", subtitle: "Under the Companies Act, 1994 (Act XVIII of 1994)",
  rows: [["Company name", "MEGHNA APPARELS LIMITED"], ["Registration No.", "<b>C-148273/2018</b>"], ["Registered office", "Plot 27, BSCIC Industrial Estate, Konabari, Gazipur 1751"],
    ["Date of incorporation", "6 March 2018"], ["Type", "Private company limited by shares"], ["Main activity", "Manufacture of woven and knit readymade garments"]],
  issued: "Given under my hand at Dhaka on 6 March 2018",
}), "1100,1300");
render("us-certificate.png", registerExtract({
  authority: "State of North Carolina · Department of the Secretary of State", title: "Certificate of Organization", subtitle: "Limited Liability Company",
  rows: [["Company name", "CAROLINA CUT &amp; SEW LLC"], ["SOSID", "<b>2214587</b>"], ["Principal office", "1180 Highland Ave NE, Hickory, NC 28601"],
    ["Date formed", "October 3, 2019"], ["Status", "Current-Active"], ["Business", "Cut and sew apparel contractor"]],
  body: "I, the Secretary of State of the State of North Carolina, do hereby certify that the Articles of Organization of CAROLINA CUT &amp; SEW LLC were filed in this office as provided by law.",
  issued: "Filed October 3, 2019",
}), "1100,1300");
render("hk-incorporation.png", registerExtract({
  authority: "Companies Registry · 公司註冊處", title: "Certificate of Incorporation · 公司註冊證明書", subtitle: "Company No. 公司編號 <b>3184276</b>",
  rows: [["Company name", "KOWLOON BAY GARMENTS LIMITED<br>九龍灣製衣有限公司"], ["Company No.", "<b>3184276</b>"], ["Registered office", "Flat B, 9/F, Kowloon Bay Industrial Centre, 15 Wang Hoi Road, Kowloon Bay, Kowloon"],
    ["Date of incorporation", "11 August 2022"], ["Type", "Private company limited by shares"], ["Business", "Garment manufacturing and export"]],
  body: "I hereby certify that KOWLOON BAY GARMENTS LIMITED is this day incorporated in Hong Kong under the Companies Ordinance (Chapter 622 of the Laws of Hong Kong), and that this company is limited.",
  issued: "Issued by the Registrar of Companies, 11 August 2022",
}), "1100,1300");

fs.rmSync(SCRATCH, { recursive: true, force: true });
