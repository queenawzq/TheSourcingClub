/**
 * Addresses that can never receive mail.
 *
 * RFC 2606 and RFC 6761 reserve example.com, example.net and example.org, and
 * the .test, .example, .invalid and .localhost top-level domains, for
 * documentation and testing. They have no mail servers, so a message to one
 * is refused by the mail provider or bounces. The demo staff login is
 * demo-admin@example.com, so this is the address a tester is most likely to
 * be signed in with.
 *
 * Shared by api/send-test-email.js (which refuses before calling the provider)
 * and the admin console (which says so before anyone presses Send).
 */
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];

/** The reserved domain of `email`, or null when the address can receive mail. */
export function reservedEmailDomain(email) {
  const domain = String(email ?? "").trim().toLowerCase().split("@")[1]?.replace(/\.$/, "");
  if (!domain) return null;
  if (RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))) return domain;
  if (RESERVED_TLDS.includes(domain.split(".").pop())) return domain;
  return null;
}

/** The sentence staff read when their own address cannot receive a test. */
export function reservedEmailNotice(email) {
  const domain = reservedEmailDomain(email);
  if (!domain) return null;
  return `${email} can't receive email: ${domain} is reserved for examples and testing and has no mailbox. To test emails, sign in to a staff account that uses a real address.`;
}
