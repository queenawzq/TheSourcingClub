/**
 * What onboarding's finish card says once staff have answered.
 *
 * A company that is not verified stays on that card. It used to say
 * "awaiting verification" whatever staff had decided, so a company asked for
 * more information, or declined, could not see what had been said to it. The
 * card now carries the notification the company was sent (its title and
 * message, from my_review_status()), on the designed card itself.
 *
 *   needs_information → the request, and "Update my profile", which opens the
 *                       designed review card; finishing the flow again sends
 *                       the profile back to staff (resubmit_for_review)
 *   declined          → the reason and who to write to; no button
 *   anything else     → null: the designed "You're all set" card, unchanged
 */
const OPERATIONS_EMAIL = "operations@contact.sourcing-club.com";
const WARNING_ICON = "/assets/prototype-icons/circle-warning.svg";

const COPY = {
  en: {
    needsTitle: "We need a little more information",
    needsFallback: "Our team needs a little more information before your profile can be verified.",
    needsCta: "Update my profile",
    declinedTitle: "We could not verify your profile",
    contact: `If you think this is a mistake, write to ${OPERATIONS_EMAIL}.`,
  },
  zh: {
    needsTitle: "我们需要更多信息",
    needsFallback: "在验证您的资料之前，我们的团队需要更多信息。",
    needsCta: "更新我的资料",
    declinedTitle: "我们无法验证您的资料",
    contact: `如果您认为这有误，请发送邮件至 ${OPERATIONS_EMAIL}。`,
  },
};

export function reviewCompletion(review, { language = "en", onUpdate } = {}) {
  const copy = COPY[language] ?? COPY.en;
  if (review?.state === "needs_information") {
    return {
      // The title is the designed copy in Chinese; the notification's own
      // title is English.
      title: language === "en" ? review.title || copy.needsTitle : copy.needsTitle,
      intro: review.message || copy.needsFallback,
      icon: WARNING_ICON,
      reward: false,
      cta: copy.needsCta,
      onCta: onUpdate,
    };
  }
  if (review?.state === "declined") {
    return {
      title: language === "en" ? review.title || copy.declinedTitle : copy.declinedTitle,
      intro: [review.message, copy.contact].filter(Boolean).join("\n\n"),
      icon: WARNING_ICON,
      reward: false,
    };
  }
  return null;
}
