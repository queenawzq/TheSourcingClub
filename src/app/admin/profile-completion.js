/**
 * How complete a company's profile is, as staff see it on the review page.
 *
 * It is the company's own figure: the same loader and the same checks as the
 * company's profile and completion pages (`/profile`, `/profile/completion`),
 * so a factory told "13% complete" and the reviewer looking at it read one
 * number with one definition. Staff used to see org_profile_completion(), a
 * count of nine onboarding columns, which said 100% for the same factory:
 * it never counted capacity, references, sample images, the walkthrough or
 * this month's capacity, all of which the company is asked to fix.
 *
 * Staff read these rows through the same `or is_platform_admin()` branches as
 * the rest of the review page.
 */
import { loadOwnBrandProfile, loadOwnProfile } from "../profile/load-profile.js";
import { brandProfileView } from "../profile/brand-profile-view.js";
import { factoryProfileView } from "../profile/factory-profile-view.js";
import { tradingProfileView } from "../profile/trading-profile-view.js";

export async function profileCompletion({ orgId, name, type, vendorKind }) {
  const org = { id: orgId, name };
  if (type === "factory") {
    const view = vendorKind === "trading_company" ? tradingProfileView : factoryProfileView;
    return view(await loadOwnProfile(org)).status.percent;
  }
  return brandProfileView(await loadOwnBrandProfile(org)).status.percent;
}
