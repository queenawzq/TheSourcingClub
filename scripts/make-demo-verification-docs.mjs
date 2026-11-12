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
const OUT = path.join(ROOT, "assets", "demo-verification");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-demo-docs-"));
const CHROME = process.env.CHROME_PATH
  ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome found; set CHROME_PATH.");

function render(name, html, size) {
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
console.log("demo verification documents → assets/demo-verification/");

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

fs.rmSync(SCRATCH, { recursive: true, force: true });
