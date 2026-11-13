/**
 * The demo accounts: the one list both scripts/seed-demo.mjs (which creates
 * them) and DemoSignIn.jsx (the test sites' one-click sign-in) read.
 *
 * A test scenario that needs an account of its own adds it here, and its
 * setup to seed-demo.mjs; the seed refuses to finish while a login here has
 * no setup. The sign-in button follows by itself, in this order.
 *
 * `role` is the button's label, `name` the person's name and their company's
 * (the admin has no company), `admin` sends the button to /admin.html.
 *
 * Only test builds load this file (see __DEMO_SIGN_IN__ in vite.config.js):
 * nothing here may be imported by code that ships to production.
 */
export const DEMO_PASSWORD = "demo password 8";

export const DEMO_LOGINS = {
  brand: { role: "Brand", name: "Demo Brand", email: "demo-brand@example.com" },
  // A member, not an owner, of Demo Brand, with Approve samples only: it
  // approves steps but cannot pay, choose a quote, write a request, invite
  // or change Settings.
  brandMember: { role: "Brand member", name: "Demo Brand (member)", email: "demo-brand-member@example.com" },
  newBrand: { role: "New brand", name: "Fresh Thread Studio", email: "demo-brand-new@example.com" },
  // Open requests from a second brand that has paid nothing yet, so Browse
  // RFQs' filters have requests to tell apart, "Payment verified" included.
  secondBrand: { role: "Brand two", name: "Maple Row Studio", email: "demo-brand-two@example.com" },
  factory: { role: "Factory", name: "Demo Factory", email: "demo-factory@example.com" },
  // A member of Demo Factory with Add update only: it posts step updates but
  // cannot send a quote, invite, or change Settings.
  factoryMember: { role: "Factory member, updates only", name: "Demo Factory (member)", email: "demo-factory-member@example.com" },
  secondFactory: { role: "Factory two", name: "Ningbo Loomworks", email: "demo-factory-two@example.com" },
  pendingBrand: { role: "Brand waiting for review", name: "Willow Lane Studio", email: "demo-brand-pending@example.com" },
  newFactory: { role: "Factory waiting for review", name: "Atlas Knit Studio", email: "demo-factory-new@example.com" },
  // Staff asked it for more information, at length: its finish card has to
  // hold the whole note.
  returnedFactory: { role: "Factory asked for more information", name: "Harbour Line Apparel", email: "demo-factory-returned@example.com" },
  // In Türkiye, waiting for review, with a tax number (VKN): the staff review
  // page's official-registry panel has Turkish sources to show.
  turkeyFactory: { role: "Factory in Türkiye waiting for review", name: "Ege Denim Atelier", email: "demo-factory-turkey@example.com" },
  tradingCompany: { role: "Trading company", name: "Kowloon Sourcing Partners", email: "demo-trading@example.com" },
  // On another email domain than every other login, so an invite to it is
  // answered with "already has an account" instead of "your own email
  // domain", which the database checks first.
  otherDomainFactory: { role: "Factory in China, PayPal; other domain", name: "Lakeside Mills", email: "demo-lakeside@example.net" },
  // Mainland China, where Stripe cannot pay out, with money waiting and no
  // withdrawal method yet, to set one up.
  chinaNewFactory: { role: "Factory in China, nothing set up", name: "Hangzhou Test Knit", email: "demo-factory-china@example.com" },
  // Verified and published in China, its whole profile written in Chinese, so
  // a brand reads it translated into English (with "See original"). Quoted on
  // Brand two's "Organic baby rompers", saved by Brand two, and messaging it
  // there. scripts/seed-demo-zh-factory.mjs adds it alone to a test database.
  zhFactory: { role: "Factory in China, profile in Chinese", name: "宁波晨织服饰有限公司", email: "demo-factory-zh@example.com" },
  // One person in three companies, each a different dashboard: switching in the
  // sidebar goes from orders to nothing yet to a factory's.
  switcher: { role: "Three companies, to switch between", name: "Demo Switcher", email: "demo-switcher@example.com" },
  // The Nov 11 verification demo: one factory per scenario, its name and
  // address as printed on the real licence it will upload, sent back "for
  // more information" with nothing uploaded yet. Sign in, upload, Confirm:
  // the checks run by themselves. (notes/demo-call-2026-11-11)
  callA: { role: "Demo A: honest factory, China", name: "南通帛都纺织品有限公司", email: "demo-call-a@example.com" },
  callB: { role: "Demo B: trading company, China", name: "广元盛远国际贸易有限公司", email: "demo-call-b@example.com" },
  callC: { role: "Demo C: watermarked copy, China", name: "合肥联晟服饰有限责任公司", email: "demo-call-c@example.com" },
  callD1: { role: "Demo D1: copies A's licence", name: "南通帛都纺织品有限公司", email: "demo-call-d1@example.com" },
  callD2: { role: "Demo D2: office photos, China", name: "东莞托晟服饰有限公司", email: "demo-call-d2@example.com" },
  callE1: { role: "Demo E1: wholesaler, Türkiye", name: "Şehriistanbul Tekstil İç ve Dış Ticaret Ltd. Şti.", email: "demo-call-e1@example.com" },
  callE2: { role: "Demo E2: certidão, Portugal", name: "Sport Clube Leiria e Marrazes", email: "demo-call-e2@example.com" },
  callE3: { role: "Demo E3: making code, Portugal", name: "Malhas e Confecções do Cávado, Lda", email: "demo-call-e3@example.com" },
  // The Nov 12 verification score: the approved mock's four cases, each with
  // its records already in place (licence read, registry, address, photos), so
  // the staff review page shows its score with nothing to run. Merter Denim
  // only shares Merter Tekstil's tax number.
  verifyCn: { role: "Score A: China, original licence", name: "Hangzhou Qianjiang Garment", email: "demo-verify-cn@example.com" },
  verifyCnCopy: { role: "Score B: China, watermarked copy", name: "Guangzhou Yuexiu Apparel", email: "demo-verify-cn-copy@example.com" },
  verifyTr: { role: "Score C: wholesaler, Türkiye", name: "Merter Tekstil", email: "demo-verify-tr@example.com" },
  verifyTrTwin: { role: "Score C2: shares C's tax number", name: "Merter Denim", email: "demo-verify-tr-twin@example.com" },
  verifyPt: { role: "Score D: Portugal, EU VIES", name: "Têxteis Douro", email: "demo-verify-pt@example.com" },
  admin: { role: "Admin", name: "Demo Admin", email: "demo-admin@example.com", admin: true },
};
