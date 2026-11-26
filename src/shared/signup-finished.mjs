/**
 * Whether a person's company finished signup, for the admin Users screen:
 * staff always have. Only a person whose company has not finished is marked
 * "Signup not finished"; a person with no company is shown as before. One
 * rule for the server's list (api/admin-users.js) and the direct read
 * (src/lib/domain/admin.js). Both spellings, as the Users screen reads either.
 *
 * @param {boolean} isAdmin
 * @param {string | null | undefined} orgId  the person's company
 * @param {Set<string>} finished  ids of companies with onboarding_completed_at
 */
export function signupFinished(isAdmin, orgId, finished) {
  const done = Boolean(isAdmin || !orgId || finished.has(orgId));
  return { signupFinished: done, signup_finished: done };
}
