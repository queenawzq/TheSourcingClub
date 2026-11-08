/**
 * What the sign-in and sign-up screens say when something goes wrong.
 *
 * The browser's own words for a request that got no answer ("Failed to fetch",
 * "Load failed") reached a real vendor on the sign-up form: nothing she could
 * act on, in the wrong language. Every failure these screens know gets a kind
 * and a hand-written sentence in each language. Anything unrecognised still
 * falls through to the original message (see readable() in src/lib/auth.jsx).
 *
 * Plain JavaScript, so scripts/check-auth-messages.mjs can run it.
 */

const SUPPORT = "operations@contact.sourcing-club.com";

const TRY_ANOTHER_EN = `If it keeps happening, try another network, such as your phone's data, or turn your VPN on or off. Still stuck? Email ${SUPPORT}.`;
const TRY_ANOTHER_ZH = `如果仍然失败，请换一个网络（例如手机流量），或开启或关闭 VPN。仍无法解决？请发邮件至 ${SUPPORT}。`;

export const AUTH_MESSAGES = {
  network: {
    en: () => `We couldn't connect to The Sourcing Club. What you typed hasn't been lost, so please try again. ${TRY_ANOTHER_EN}`,
    zh: () => `无法连接到 The Sourcing Club。你填写的内容没有丢失，请重试。${TRY_ANOTHER_ZH}`,
  },
  timeout: {
    en: () => `This is taking too long, so the connection may be slow or blocked. What you typed hasn't been lost, so please try again. ${TRY_ANOTHER_EN}`,
    zh: () => `等待时间过长，网络连接可能较慢或被阻断。你填写的内容没有丢失，请重试。${TRY_ANOTHER_ZH}`,
  },
  company_network: {
    en: () => "Your account is ready, but we couldn't connect to finish setting up your company. Press Continue to try again.",
    zh: () => "你的账户已创建，但无法连接以完成公司设置。请点击 Continue 重试。",
  },
  reset_network: {
    en: () => "We couldn't connect, so the reset email may not have been sent. Check your connection and try again.",
    zh: () => "无法连接，重置密码邮件可能未发送。请检查网络后重试。",
  },
  no_connection: {
    en: () => "Couldn't connect. Try again.",
    zh: () => "无法连接，请重试。",
  },
  invalid_credentials: {
    en: () => "That email and password do not match an account.",
    zh: () => "邮箱和密码与账户不匹配。",
  },
  account_exists: {
    en: () => "An account already exists for that email. Log in instead.",
    zh: () => "该邮箱已有账户，请直接登录。",
  },
  short_password: {
    en: ({ min }) => `Use at least ${min} characters.`,
    zh: ({ min }) => `密码至少需要 ${min} 个字符。`,
  },
  email_not_confirmed: {
    en: () => "Confirm your email address first — check your inbox.",
    zh: () => "请先确认你的邮箱地址，请查看收件箱。",
  },
  confirm_to_continue: {
    en: () => "Check your email to confirm your address, then log in.",
    zh: () => "请查收邮件确认邮箱地址，然后登录。",
  },
  rate_limited: {
    en: () => "Too many attempts just now. Wait a minute and try again.",
    zh: () => "尝试次数过多，请稍等一分钟后重试。",
  },
};

/** An Error the screens can word in the reader's language; `message` stays the English. */
export function authFailure(kind, vars = {}) {
  const failure = new Error(AUTH_MESSAGES[kind].en(vars));
  failure.kind = kind;
  failure.vars = vars;
  return failure;
}

/**
 * Did the request get no usable answer at all?
 *
 * Three shapes: auth-js's AuthRetryableFetchError (no reply, or a gateway's
 * 5xx), a plain fetch TypeError, and PostgREST's, which arrives as text inside
 * the domain layer's message ("create your organisation: TypeError: Failed to
 * fetch"). A refusal from the server is none of these: it has words of its own.
 */
export function isNoAnswer(error) {
  if (!error) return false;
  if (error.noAnswer || error.name === "AuthRetryableFetchError") return true;
  return /Failed to fetch|Load failed|NetworkError when attempting|fetch failed/i.test(String(error.message ?? error));
}

/**
 * Which languages to say it in, most useful first.
 *
 * The page's language, and only that one (Queena, Nov 7: one language per
 * screen). A vendor's page in Chinese reads Chinese; every other page English,
 * whatever the browser speaks.
 */
export function authLanguages({ factory, zhPage }) {
  if (!factory) return ["en"];
  return zhPage ? ["zh"] : ["en"];
}

/** The sentences for this error, one per language, or null if it has no kind. */
export function authErrorLines(error, languages) {
  const message = error?.kind ? AUTH_MESSAGES[error.kind] : null;
  if (!message) return null;
  return languages.map((language) => message[language](error.vars ?? {}));
}
