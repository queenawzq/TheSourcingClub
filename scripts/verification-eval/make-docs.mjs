/**
 * Builds the made-up registration documents for the verification eval.
 *
 *   node scripts/verification-eval/make-docs.mjs
 *
 * Every document is drawn as HTML in the real layout (China's 营业执照,
 * Turkey's Vergi Levhası, Portugal's Certidão Permanente) and rendered by
 * headless Chrome to PNG or PDF. EVERY one carries a visible
 * "SPECIMEN / 测试样本" stamp: none of them can pass for a real document.
 * Companies, people and addresses are invented; the numbers are generated
 * with valid check digits (except where a case says otherwise) so the
 * number checks see what a real licence would give them.
 *
 * The photo cases (rotated, blurred, cropped) are made from the rendered PNG
 * with Python's Pillow. Re-running overwrites docs/<case>/document.* and
 * expected.json; real public documents (docs/public-*) are left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { usccCheckChar, nifCheckDigit, vknCheckDigit } from "../../src/shared/registration-number.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DOCS = path.join(HERE, "docs");
const CHROME = process.env.CHROME_PATH
  ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome found; set CHROME_PATH.");

const uscc = (first17) => first17 + usccCheckChar(first17);
const nipc = (first8) => first8 + nifCheckDigit(first8);
const vkn = (first9) => first9 + vknCheckDigit(first9);

const STAMP = `<div class="specimen">SPECIMEN / 测试样本</div>`;
const STAMP_CSS = `.specimen{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font:900 92px/1 Arial,sans-serif;color:rgba(220,20,20,.32);border:10px solid rgba(220,20,20,.32);padding:14px 36px;white-space:nowrap;letter-spacing:4px;pointer-events:none;z-index:9}`;

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function chinaLicence(d) {
  const code = d.codeHtml ?? d.code;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#f4efe4;font-family:"Songti SC","STSong","SimSun",serif;color:#222}
  .sheet{position:relative;width:1400px;height:1000px;box-sizing:border-box;border:22px double #b8862e;padding:40px 70px;background:#fbf7ee}
  .emblem{width:96px;height:96px;border-radius:50%;background:radial-gradient(#e2b43a,#b8862e);margin:0 auto}
  h1{font-size:76px;letter-spacing:40px;text-align:center;margin:10px 0 4px;font-weight:700}
  .dup{text-align:center;font-size:22px;margin-bottom:20px}
  .top{display:flex;justify-content:space-between;font-size:24px;margin-bottom:26px}
  .qr{width:120px;height:120px;background:repeating-linear-gradient(90deg,#222 0 6px,#fff 6px 12px),#fff;opacity:.85}
  table{width:100%;font-size:26px;border-collapse:collapse}
  td{padding:9px 6px;vertical-align:top}
  td.k{width:150px;letter-spacing:6px;white-space:nowrap}
  .cols{display:flex;gap:40px}.cols table{flex:1}
  .foot{position:absolute;right:90px;bottom:60px;text-align:center;font-size:24px}
  .seal{width:170px;height:170px;border:5px solid rgba(200,20,20,.75);border-radius:50%;color:rgba(200,20,20,.75);display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 8px}
  .note{position:absolute;left:70px;bottom:40px;font-size:18px;color:#555}
  ${STAMP_CSS}${d.css ?? ""}</style></head><body><div class="sheet">
  <div class="emblem"></div><h1>营业执照</h1><div class="dup">（副　本）</div>
  <div class="top"><div>统一社会信用代码<br><b style="font-size:30px;letter-spacing:2px">${code}</b></div><div class="qr"></div></div>
  <div class="cols"><table>
    <tr><td class="k">名　　称</td><td>${d.name}</td></tr>
    <tr><td class="k">类　　型</td><td>${d.type}</td></tr>
    <tr><td class="k">法定代表人</td><td>${d.rep}</td></tr>
    <tr><td class="k">经营范围</td><td>${d.scope}</td></tr>
  </table><table style="max-width:520px">
    <tr><td class="k">注册资本</td><td>${d.capital}</td></tr>
    <tr><td class="k">成立日期</td><td>${d.founded}</td></tr>
    <tr><td class="k">营业期限</td><td>${d.term}</td></tr>
    <tr><td class="k">住　　所</td><td>${d.address}</td></tr>
  </table></div>
  <div class="foot"><div class="seal">登记机关</div>${d.authority}<br>${d.issued}</div>
  <div class="note">国家企业信用信息公示系统网址：</div>
  ${STAMP}</div></body></html>`;
}

function turkeyLetter(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111}
  .sheet{position:relative;width:1240px;height:880px;box-sizing:border-box;border:3px solid #333;padding:36px 50px}
  .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #333;padding-bottom:14px}
  .hdr h1{font-size:30px;margin:0;text-align:center;flex:1}
  .logo{width:90px;height:90px;border-radius:50%;background:#c8102e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
  table{width:100%;border-collapse:collapse;margin-top:20px;font-size:21px}
  td{border:1px solid #555;padding:10px 12px;vertical-align:top}td.k{width:330px;font-weight:700;background:#f1f1f1}
  .years td{text-align:center}
  .foot{margin-top:18px;font-size:16px;color:#333}
  ${STAMP_CSS}</style></head><body><div class="sheet">
  <div class="hdr"><div class="logo">GİB</div><h1>T.C.<br>GELİR İDARESİ BAŞKANLIĞI<br>VERGİ LEVHASI</h1><div style="width:90px"></div></div>
  <table>
    <tr><td class="k">ADI SOYADI / TİCARET ÜNVANI</td><td>${d.name}</td></tr>
    <tr><td class="k">İŞ YERİ ADRESİ</td><td>${d.address}</td></tr>
    <tr><td class="k">VERGİ TÜRÜ</td><td>KURUMLAR VERGİSİ</td></tr>
    <tr><td class="k">VERGİ DAİRESİ</td><td>${d.office}</td></tr>
    <tr><td class="k">VERGİ KİMLİK NO</td><td><b>${d.vkn}</b></td></tr>
    <tr><td class="k">İŞE BAŞLAMA TARİHİ</td><td>${d.started}</td></tr>
    <tr><td class="k">ANA FAALİYET KODU VE ADI</td><td>${d.activity}</td></tr>
  </table>
  <table class="years"><tr><td class="k">TAKVİM YILI</td><td>2023</td><td>2024</td><td>2025</td></tr>
  <tr><td class="k">BEYAN EDİLEN MATRAH</td><td>4.812.300,00</td><td>6.105.900,00</td><td>7.443.210,00</td></tr></table>
  <div class="foot">Onay Kodu: ${d.approval} — Bu belge elektronik ortamda oluşturulmuştur. Doğruluğunu www.gib.gov.tr adresinden kontrol edebilirsiniz.</div>
  ${STAMP}</div></body></html>`;
}

function portugalCertidao(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:16mm}
  body{margin:0;font-family:"Times New Roman",serif;color:#111;font-size:14px}
  .sheet{position:relative;min-height:250mm}
  .hdr{border-bottom:2px solid #0b4f2f;padding-bottom:8px;margin-bottom:12px}
  .hdr b{font-size:18px;color:#0b4f2f}
  h1{font-size:20px;text-align:center;margin:14px 0}
  .sec{font-weight:700;margin-top:14px;border-bottom:1px solid #999}
  p{margin:5px 0;line-height:1.4}
  ${STAMP_CSS}.specimen{font-size:58px;top:30%}</style></head><body><div class="sheet">
  <div class="hdr"><b>REPÚBLICA PORTUGUESA — JUSTIÇA</b><br>Instituto dos Registos e do Notariado, I.P. · Registo Comercial</div>
  <h1>CERTIDÃO PERMANENTE</h1>
  <p>Código de acesso: ${d.access} &nbsp;&nbsp; Válida até: 2027-03-02</p>
  <div class="sec">MATRÍCULA</div>
  <p>NIPC: <b>${d.nipc}</b></p>
  <p>Firma: <b>${d.name}</b></p>
  <p>Natureza Jurídica: SOCIEDADE POR QUOTAS</p>
  <p>Sede: ${d.address}</p>
  <p>Objeto: ${d.object}</p>
  <p>CAE Principal: ${d.cae}</p>
  <p>Capital: 50.000,00 Euros</p>
  <div class="sec">INSCRIÇÕES — AVERBAMENTOS — ANOTAÇÕES</div>
  <p>Insc.1 AP. 14/20150611 — CONTRATO DE SOCIEDADE E DESIGNAÇÃO DE MEMBRO(S) DE ÓRGÃO(S) SOCIAL(AIS)</p>
  <p>GERÊNCIA: ${d.managers}</p>
  <p>Forma de obrigar: Com a assinatura de um gerente.</p>
  <p>Conservatória do Registo Comercial de ${d.registry}</p>
  ${STAMP}</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const FACTORY_SCOPE = "服装、针织品的生产、加工；纺织面料的制造与销售；货物进出口（法律、行政法规禁止的项目除外）。（依法须经批准的项目，经相关部门批准后方可开展经营活动）";
const TRADER_SCOPE = "服装、鞋帽、纺织品、针纺织品的批发、零售；货物进出口；技术进出口；国内贸易代理。（依法须经批准的项目，经相关部门批准后方可开展经营活动）";

const base = {
  type: "有限责任公司（自然人投资或控股）", capital: "伍佰万元整", founded: "2016年04月18日", term: "2016年04月18日至长期",
  authority: "宁波市海曙区市场监督管理局", issued: "2025年03月12日",
};

const ningbo = { ...base, code: uscc("91330203MA2AH7K5X"), name: "宁波明纬服饰制造有限公司", rep: "陈立华", scope: FACTORY_SCOPE, address: "浙江省宁波市海曙区望春工业园区科创路118号" };
const yiwu = { ...base, code: uscc("91330782MA2EC3N1T"), name: "义乌市恒越进出口贸易有限公司", rep: "王晓梅", scope: TRADER_SCOPE, address: "浙江省义乌市稠城街道工人北路1088号国际商贸城B座1602室", authority: "义乌市市场监督管理局" };
const dongguan = { ...base, code: uscc("91441900MA4UJ8P2W"), name: "东莞市锦绣针织制衣有限公司", rep: "李振东", scope: FACTORY_SCOPE, address: "广东省东莞市虎门镇路东社区工业区二路6号", authority: "东莞市市场监督管理局" };
const shaoxing = { ...base, code: uscc("91330621MA2BQ4D6Y"), name: "绍兴柯桥华纺服装有限公司", rep: "周建平", scope: FACTORY_SCOPE, address: "浙江省绍兴市柯桥区齐贤街道工业园区兴齐路22号", authority: "绍兴市柯桥区市场监督管理局" };
const quanzhou = { ...base, code: uscc("91350582MA31W9B3K"), name: "晋江市鸿盛运动服饰有限公司", rep: "林国荣", scope: FACTORY_SCOPE, address: "福建省晋江市陈埭镇鞋都工业区5号", authority: "晋江市市场监督管理局" };
const suzhou = { ...base, code: uscc("91320506MA1Y6R2L0"), name: "苏州吴中丝韵制衣有限公司", rep: "沈佳怡", scope: FACTORY_SCOPE, address: "江苏省苏州市吴中区木渎镇金枫南路888号3幢", authority: "苏州市吴中区市场监督管理局" };

// The edited number: the last six characters changed and set in another
// face, size and weight, slightly off the line, as a careless edit looks.
const editedTrue = uscc("91310115MA1K4P7Q2");
const editedShown = `${editedTrue.slice(0, 12)}<span style="font-family:Arial,sans-serif;font-size:27px;font-weight:400;position:relative;top:3px;letter-spacing:0;background:#fdfaf2">583917</span>`;
const editedNumber = editedTrue.slice(0, 12) + "583917";
const shanghai = { ...base, code: editedNumber, codeHtml: editedShown, name: "上海浦东嘉禾服装制造有限公司", rep: "黄志强", scope: FACTORY_SCOPE, address: "上海市浦东新区康桥镇秀浦路2555号5幢", authority: "上海市浦东新区市场监督管理局" };

const ZW = "​";

const turkey = { name: "ANADOLU TEKSTİL KONFEKSİYON SANAYİ VE TİCARET LİMİTED ŞİRKETİ", address: "ORGANİZE SANAYİ BÖLGESİ 4. CADDE NO: 17 YEŞİLYURT / DENİZLİ", office: "PAMUKKALE VERGİ DAİRESİ", vkn: vkn("068412739"), started: "02.09.2011", activity: "141302 — Dış giyim eşyası imalatı (dokuma kumaştan)", approval: "TSCE2V0SPEC1MEN" };
const turkeyTrader = { name: "BOĞAZİÇİ TEKSTİL DIŞ TİCARET LİMİTED ŞİRKETİ", address: "MERKEZEFENDİ MAH. 10/1 SOK. NO: 5 İÇ KAPI NO: 12 ZEYTİNBURNU / İSTANBUL", office: "ZEYTİNBURNU VERGİ DAİRESİ", vkn: vkn("183305927"), started: "15.03.2018", activity: "464201 — Giyim eşyası toptan ticareti (iç giyim dahil)", approval: "TSCE2V0SPEC1MEN2" };
const portugal = { access: "1234-5678-9012", nipc: nipc("51487632"), name: "FIAÇÃO E CONFEÇÕES DO AVE, LDA.", address: "Rua da Indústria, n.º 245, Zona Industrial de Ronfe, 4805-470 Guimarães", object: "Fabricação e confeção de vestuário exterior em série, malhas e artigos têxteis; comércio por grosso dos produtos fabricados.", cae: "14131-R3 — Confeção de outro vestuário exterior em série", managers: "MARIA JOÃO PEREIRA COSTA; ANTÓNIO MANUEL FERREIRA SILVA", registry: "Guimarães" };

const chinaFields = (d, number = d.code) => ({
  registrationNumber: number, legalName: d.name, legalRepresentative: d.rep, address: d.address,
  businessScopeIncludes: d.scope === TRADER_SCOPE ? "批发" : "生产",
});
const allFlags = { trading_scope: false, name_differs: false, number_differs: false, address_differs: false, specimen_or_edited: true, unreadable: false };

const CASES = [
  {
    id: "cn-factory", kind: "png", html: chinaLicence(ningbo),
    about: "A real factory's scope (生产、加工、制造), typed details match. Nothing should fire except the specimen stamp.",
    typed: { country: "CN", number: "", title: "宁波明纬服饰制造有限公司", location: "浙江省宁波市海曙区望春工业园区科创路118号" },
    fields: chinaFields(ningbo), flags: { ...allFlags },
  },
  {
    id: "cn-trader", kind: "png", html: chinaLicence(yiwu),
    about: "Trading only: 批发、零售、货物进出口、贸易代理, no 生产/制造/加工. Trading scope must fire.",
    typed: { country: "CN", number: "", title: "义乌市恒越进出口贸易有限公司", location: "浙江省义乌市稠城街道工人北路1088号国际商贸城B座1602室" },
    fields: chinaFields(yiwu), flags: { ...allFlags, trading_scope: true },
  },
  {
    id: "cn-name-differs", kind: "png", html: chinaLicence(dongguan),
    about: "The factory typed another company's name than the licence's.",
    typed: { country: "CN", number: "", title: "东莞市新时代服装有限公司", location: "广东省东莞市虎门镇路东社区工业区二路6号" },
    fields: chinaFields(dongguan), flags: { ...allFlags, name_differs: true },
  },
  {
    id: "cn-address-differs", kind: "png", html: chinaLicence(shaoxing),
    about: "The typed address is in another city (Hangzhou) from the licence's 住所 (Shaoxing).",
    typed: { country: "CN", number: "", title: "绍兴柯桥华纺服装有限公司", location: "浙江省杭州市萧山区宁围街道市心北路857号" },
    fields: chinaFields(shaoxing), flags: { ...allFlags, address_differs: true },
  },
  {
    id: "cn-zero-width", kind: "pdf", html: chinaLicence({ ...quanzhou, code: quanzhou.code.slice(0, 9) + ZW + quanzhou.code.slice(9) }),
    about: "A PDF whose text layer has an invisible U+200B inside the code (copied documents carry these). The typed number is the clean code, so no number difference may fire.",
    typed: { country: "CN", number: quanzhou.code, title: "晋江市鸿盛运动服饰有限公司", location: "福建省晋江市陈埭镇鞋都工业区5号" },
    fields: chinaFields(quanzhou), flags: { ...allFlags },
  },
  {
    id: "cn-photo-skewed", kind: "png", html: chinaLicence(suzhou), photo: "skewed",
    about: "A phone photo: rotated 7°, slightly blurred, darker, edges cropped. Still readable; fields should come out.",
    typed: { country: "CN", number: "", title: "苏州吴中丝韵制衣有限公司", location: "江苏省苏州市吴中区木渎镇金枫南路888号" },
    fields: chinaFields(suzhou), flags: { ...allFlags },
  },
  {
    id: "cn-photo-unreadable", kind: "png", html: chinaLicence(ningbo), photo: "unreadable",
    about: "Heavily blurred, low-resolution and cropped to the top half: the text cannot be read. Must be called unreadable, with no invented fields.",
    typed: { country: "CN", number: "", title: "宁波明纬服饰制造有限公司", location: "浙江省宁波市海曙区望春工业园区科创路118号" },
    fields: {}, flags: { ...allFlags, unreadable: true }, mustNotInvent: true,
  },
  {
    id: "cn-edited-number", kind: "png", html: chinaLicence(shanghai),
    about: "The last six characters of the code are pasted in another font, size and baseline, and fail the check digit. Edit must be noticed.",
    typed: { country: "CN", number: "", title: "上海浦东嘉禾服装制造有限公司", location: "上海市浦东新区康桥镇秀浦路2555号5幢" },
    fields: chinaFields(shanghai, editedNumber), flags: { ...allFlags }, edited: true,
  },
  {
    id: "tr-factory", kind: "png", html: turkeyLetter(turkey),
    about: "A clean Turkish vergi levhası of a garment maker (imalatı), typed VKN matches.",
    typed: { country: "TR", number: turkey.vkn, title: "Anadolu Tekstil Konfeksiyon Sanayi ve Ticaret Ltd. Şti.", location: "Organize Sanayi Bölgesi 4. Cadde No:17 Yeşilyurt, Denizli" },
    fields: { registrationNumber: turkey.vkn, legalName: turkey.name, address: turkey.address, taxOffice: turkey.office, businessScopeIncludes: "imalat" },
    flags: { ...allFlags },
  },
  {
    id: "tr-zero-width-typed", kind: "png", html: turkeyLetter(turkey),
    about: "Same letter; the typed VKN was pasted with a zero-width space inside. Must not read as a different number.",
    typed: { country: "TR", number: turkey.vkn.slice(0, 5) + ZW + turkey.vkn.slice(5), title: "Anadolu Tekstil Konfeksiyon Sanayi ve Ticaret Ltd. Şti.", location: "Organize Sanayi Bölgesi 4. Cadde No:17 Yeşilyurt, Denizli" },
    fields: { registrationNumber: turkey.vkn, legalName: turkey.name, taxOffice: turkey.office },
    flags: { ...allFlags },
  },
  {
    id: "tr-trader", kind: "png", html: turkeyLetter(turkeyTrader),
    about: "A Turkish wholesaler (toptan ticareti), no imalat. Trading scope must fire.",
    typed: { country: "TR", number: turkeyTrader.vkn, title: "Boğaziçi Tekstil Dış Ticaret Ltd. Şti.", location: "Zeytinburnu, İstanbul" },
    fields: { registrationNumber: turkeyTrader.vkn, legalName: turkeyTrader.name, taxOffice: turkeyTrader.office, businessScopeIncludes: "toptan" },
    flags: { ...allFlags, trading_scope: true },
  },
  {
    id: "pt-factory", kind: "pdf", html: portugalCertidao(portugal),
    about: "A clean Portuguese certidão permanente (PDF) of a garment maker (CAE 14131), typed NIPC matches.",
    typed: { country: "PT", number: portugal.nipc, title: "Fiação e Confeções do Ave, Lda", location: "Rua da Indústria 245, Zona Industrial de Ronfe, Guimarães" },
    fields: { registrationNumber: portugal.nipc, legalName: portugal.name, address: portugal.address, businessScopeIncludes: "confeção" },
    flags: { ...allFlags },
  },
  {
    id: "pt-number-differs", kind: "pdf", html: portugalCertidao(portugal),
    about: "Same certidão; the factory typed another company's NIPC (valid check digit). Number difference must fire.",
    typed: { country: "PT", number: nipc("50993124"), title: "Fiação e Confeções do Ave, Lda", location: "Rua da Indústria 245, Zona Industrial de Ronfe, Guimarães" },
    fields: { registrationNumber: portugal.nipc, legalName: portugal.name },
    flags: { ...allFlags, number_differs: true },
  },
];

// ---------------------------------------------------------------------------

const SCRATCH = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "verification-eval-"));

function render(html, out, kind, size) {
  const file = path.join(SCRATCH, `${path.basename(path.dirname(out))}.html`);
  fs.writeFileSync(file, html);
  const common = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(SCRATCH, "profile")}`];
  if (kind === "pdf") execFileSync(CHROME, [...common, `--print-to-pdf=${out}`, "--no-pdf-header-footer", `file://${file}`], { stdio: "ignore" });
  else execFileSync(CHROME, [...common, `--screenshot=${out}`, `--window-size=${size}`, `file://${file}`], { stdio: "ignore" });
}

const PHOTO = {
  skewed: `from PIL import Image, ImageFilter, ImageEnhance
im = Image.open(src).convert("RGB")
bg = Image.new("RGB", (im.width + 260, im.height + 260), (92, 84, 70))
bg.paste(im, (130, 130))
im = bg.rotate(7, resample=Image.BICUBIC, fillcolor=(92, 84, 70))
im = im.crop((150, 120, im.width - 60, im.height - 150))
im = ImageEnhance.Brightness(im).enhance(0.82).filter(ImageFilter.GaussianBlur(1.3))
im = im.resize((im.width * 3 // 4, im.height * 3 // 4))
im.save(dst, quality=80)`,
  unreadable: `from PIL import Image, ImageFilter
im = Image.open(src).convert("RGB")
im = im.crop((0, 0, im.width, im.height // 2)).resize((280, 100)).filter(ImageFilter.GaussianBlur(3)).resize((1120, 400))
im.save(dst)`,
};

for (const c of CASES) {
  const dir = path.join(DOCS, c.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const old of fs.readdirSync(dir)) if (old.startsWith("document.")) fs.rmSync(path.join(dir, old));
  const out = path.join(dir, `document.${c.kind}`);
  const size = c.html.includes("VERGİ LEVHASI") ? "1240,880" : "1400,1000";
  render(c.html, out, c.kind, size);
  if (c.photo) {
    const raw = path.join(SCRATCH, `${c.id}-raw.png`);
    fs.renameSync(out, raw);
    const dst = c.photo === "skewed" ? path.join(dir, "document.jpg") : out;
    execFileSync("python3", ["-c", `src, dst = ${JSON.stringify(raw)}, ${JSON.stringify(dst)}\n${PHOTO[c.photo]}`]);
  }
  const expected = {
    about: c.about,
    source: "made up (scripts/verification-eval/make-docs.mjs); carries a SPECIMEN / 测试样本 stamp",
    typed: c.typed,
    fields: c.fields,
    flags: c.flags,
    ...(c.edited ? { edited: true } : {}),
    ...(c.mustNotInvent ? { mustNotInvent: true } : {}),
  };
  fs.writeFileSync(path.join(dir, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`made ${c.id}`);
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
