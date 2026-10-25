/**
 * The contact-detail patterns (api/_message-patterns.js), checked both ways.
 *
 * A miss lets a phone number through to the other side; a false hit holds an
 * ordinary message about quantities and prices until staff release it, which
 * stalls an order. Both lists matter, the second as much as the first.
 */
import { findContactDetails } from "../api/_message-patterns.js";

const HOLD = [
  ["Email me at sourcing@demo-brand.example.com", "an email address"],
  ["my email: Li.Wei+orders@gmail.com", "an email address"],
  ["write to lina [at] maisonrue [dot] com", "an email address"],
  ["lina at maisonrue dot com", "an email address"],
  ["Call me on +44 7700 900123", "a phone number"],
  ["+86 138-0013-8000", "a phone number"],
  ["+1 (415) 555-0132", "a phone number"],
  ["my number is 020 7946 0018", "a phone number"],
  ["手机 13800138000", "a phone number"],
  ["电话一三八零零一三八零零零", "a phone number"],
  ["１３８００１３８０００", "a phone number"],
  ["07700 900 123", "a phone number"],
  ["Easier to sort the details on WeChat, my ID is demo_brand_88.", "a WeChat contact"],
  ["加我微信 lina_2026", "a WeChat contact"],
  ["Add me on WhatsApp", "a WhatsApp contact"],
  ["whatsapp: lina88", "a WhatsApp contact"],
  ["wa.me/447700900123", "a link"],
  ["QQ号 123456789", "a QQ contact"],
  ["vx: linamaison01", "a WeChat contact"],
  ["Telegram @lina_rue", "a Telegram contact"],
  ["my skype is lina.rue", "a Skype contact"],
  ["see our catalogue at https://maisonrue.fr/ss27", "a link"],
  ["www.maisonrue.com has the lookbook", "a link"],
  ["it's on maisonrue.com", "a link"],
  ["find us on instagram @maisonrue", "an Instagram contact"],
  ["DM @maison.rue", "a social media handle"],
  ["WeChat ID: maisonrue", "a WeChat contact"],
  ["Message me on Facebook", "a Facebook contact"],
  ["WhatsApp me when the sample ships", "a WhatsApp contact"],
  ["Our Instagram is maison.rue", "an Instagram contact"],
  ["Let's talk on WeChat instead", "a WeChat contact"],
  // Found slipping through by the independent test of Oct 25 (and with them
  // through a call's title, which no model reads).
  ["Ring 07700 900123", "a phone number"],
  ["call me on 07700900123", "a phone number"],
  ["call 2125550187", "a phone number"],
  ["Text me first on 07700900123 or call 2125550187", "a phone number"],
  ["1 3 8 1 2 3 4 5 6 7 8", "a phone number"],
  ["my mobile is 1 3 8 1 2 3 4 5 6 7 8", "a phone number"],
  ["我的电话 一三八 一二三四 五六七八", "a phone number"],
  ["j o h n @ g m a i l . c o m", "an email address"],
  ["Visit tscmill dot com", "a link"],
  ["tscmill [dot] com", "a link"],
  ["q q:12345678", "a QQ contact"],
  ["call 12125550187", "a phone number"],
  ["447700900123 on whatsapp later", "a phone number"],
  ["8613800138000", "a phone number"],
  ["0 7 7 0 0 9 0 0 1 2 3", "a phone number"],
];

const HOLD_FILES = [
  [["wechat_qr.png"], "a WeChat contact in an attachment's name"],
  [["my-qr-code.jpg"], "a QR code in an attachment's name"],
  [["lina@maisonrue.com.pdf"], "an email address in an attachment's name"],
  [["contact +44 7700 900123.pdf"], "a phone number in an attachment's name"],
];

const DELIVER = [
  "Could you confirm the lab dip timing before we award?",
  "Order TSC-000013 is ready for the fit sample.",
  "TSC-000090 and TSC-000091 ship together",
  "The price is $18.40 per unit, $5,520.00 in total.",
  "Total $1,250,000 for 100000 units",
  "300 units, 28 days lead time",
  "MOQ 500, 190 gsm, 30% deposit / 70% before shipment",
  "Ship by 2026-10-12, or 12/10/2026 at the latest.",
  "Sizes S M L XL, 34 36 38 40 42",
  "Quantities: 1500 2500 3000 units",
  "Chest 52.5 cm, length 71 cm, sleeve 63.5 cm",
  "Pantone 19-4052 TCX for the navy",
  "We can do 1200 pcs per month",
  "Style 2401-0032 in sand",
  "袖口按照新的尺寸表做好了，确认一下。",
  "我们可以做300件，交期28天。",
  "We don't use WhatsApp for orders, everything stays here.",
  "Let's look at the fit sample first.",
  "Use the line in the tech pack for the pocket placement.",
  "Support is operations@contact.sourcing-club.com",
  "Reference v2.0 of the tech pack",
  "Price @ 18.40 each",
  "Fabric code 1120034 from the mill",
  // An app's name beside an everyday word is the model's to judge.
  "Please send the messenger bag sample on Monday.",
  "We saw your knitwear as seen on Instagram, great work.",
  "WhatsApp is easier for my team, but we'll keep it here.",
  // Asking for a call is ordinary: the platform has its own calls. Held on
  // #51's preview on 23 Oct (by the model; check-message-screen.mjs pins that).
  "Hi Ningbo, thanks for the quote. Could we talk through the fit sample on a short call?",
  "Can we have a quick video call tomorrow to go over the lab dips?",
  "Let's schedule a meeting next week to review the PP sample.",
  // Next to the shapes added on Oct 25: runs of digits that are not phones,
  // spaced letters that are not addresses, "dot" that is not a domain.
  "Order TSC-000022 is in production",
  "Invoice 2026102501 attached",
  "PO 4500012345 for the jersey",
  "Barcode 4006381333931 on the swing tag",
  "300 units at $12.50, total $3,750.00",
  "Total 2125550187 units across the season",
  "MOQ 1000 pcs, lead time 45 days, ship 2026-11-02",
  "Delivery 25/10/2026, samples by 2026年11月1日",
  "Sizes XS S M L XL XXL",
  "Size run 2 4 6 8 10 12",
  "Ratio 1 2 2 1 for S M L XL",
  "Years 2024 2025 2026 all in stock",
  "Payment 30% deposit, 70% before shipment, $18,400.00",
  "Fabric 100% cotton, 180 gsm, width 150 cm",
  "Carton 60 x 40 x 35 cm, 12 pcs per carton",
  "We loved the polka dot co-ord in your lookbook.",
  "Polka dot com-pared to stripes looks better",
  "That was in the dot com bubble years.",
  "一件一套，一共三百件",
  "数量：一千二百件，交期三十天",
  "Q4 delivery, Q1 reorder",
  "Price is 1 2 . 5 0 USD",
];

const DELIVER_FILES = [
  ["SS27-linen-overshirt-techpack.pdf"],
  ["fit_sample_front.jpg", "size-chart-v2.xlsx"],
  ["IMG_20261012_143022.jpg"],
  ["messenger-bag-front.jpg"],
];

let failures = 0;
const fail = (message) => { failures += 1; console.log(`  ✗ ${message}`); };

for (const [text, reason] of HOLD) {
  const result = findContactDetails(text);
  if (!result.hit) fail(`missed: "${text}" (expected ${reason})`);
  else if (result.reason !== reason) fail(`"${text}": reason "${result.reason}", expected "${reason}"`);
}
for (const [files, reason] of HOLD_FILES) {
  const result = findContactDetails("Here is the file.", files);
  if (!result.hit) fail(`missed attachment ${files.join(", ")} (expected ${reason})`);
  else if (result.reason !== reason) fail(`${files.join(", ")}: reason "${result.reason}", expected "${reason}"`);
}
for (const text of DELIVER) {
  const result = findContactDetails(text);
  if (result.hit) fail(`false hit: "${text}" (${result.reason})`);
}
for (const files of DELIVER_FILES) {
  const result = findContactDetails("Photos attached.", files);
  if (result.hit) fail(`false hit on attachment ${files.join(", ")} (${result.reason})`);
}

const total = HOLD.length + HOLD_FILES.length + DELIVER.length + DELIVER_FILES.length;
if (failures) {
  console.log(`check:messages: ${failures} of ${total} pattern checks failed`);
  process.exit(1);
}
console.log(`check:messages: all ${total} pattern checks pass (${HOLD.length + HOLD_FILES.length} held, ${DELIVER.length + DELIVER_FILES.length} delivered)`);
