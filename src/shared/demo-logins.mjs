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
  newBrand: { role: "New brand", name: "Fresh Thread Studio", email: "demo-brand-new@example.com" },
  factory: { role: "Factory", name: "Demo Factory", email: "demo-factory@example.com" },
  secondFactory: { role: "Factory two", name: "Ningbo Loomworks", email: "demo-factory-two@example.com" },
  newFactory: { role: "Factory waiting for review", name: "Atlas Knit Studio", email: "demo-factory-new@example.com" },
  tradingCompany: { role: "Trading company", name: "Kowloon Sourcing Partners", email: "demo-trading@example.com" },
  admin: { role: "Admin", name: "Demo Admin", email: "demo-admin@example.com", admin: true },
};
