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
  newFactory: { role: "Factory waiting for review", name: "Atlas Knit Studio", email: "demo-factory-new@example.com" },
  // Staff asked it for more information, at length: its finish card has to
  // hold the whole note.
  returnedFactory: { role: "Factory asked for more information", name: "Harbour Line Apparel", email: "demo-factory-returned@example.com" },
  tradingCompany: { role: "Trading company", name: "Kowloon Sourcing Partners", email: "demo-trading@example.com" },
  // On another email domain than every other login, so an invite to it is
  // answered with "already has an account" instead of "your own email
  // domain", which the database checks first.
  otherDomainFactory: { role: "Factory, other domain", name: "Lakeside Mills", email: "demo-lakeside@example.net" },
  // Mainland China, where Stripe cannot pay out: one paid through PayPal, and
  // one with money waiting and no withdrawal method yet, to set one up.
  chinaPaypalFactory: { role: "Factory in China, PayPal", name: "Suzhou Test Silk", email: "demo-factory-paypal@example.com" },
  chinaNewFactory: { role: "Factory in China, nothing set up", name: "Hangzhou Test Knit", email: "demo-factory-china@example.com" },
  // One person in three companies, each a different dashboard: switching in the
  // sidebar goes from orders to nothing yet to a factory's.
  switcher: { role: "Three companies, to switch between", name: "Demo Switcher", email: "demo-switcher@example.com" },
  admin: { role: "Admin", name: "Demo Admin", email: "demo-admin@example.com", admin: true },
};
