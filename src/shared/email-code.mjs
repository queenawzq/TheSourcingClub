// Keep this in sync with [auth.email].max_frequency in supabase/config.toml.
export const EMAIL_CODE_RESEND_SECONDS = 10;

export function emailCodeRetryAfter(error) {
  if (error?.code !== "over_email_send_rate_limit") return 0;
  const seconds = Number(error.message?.match(/after (\d+) seconds?\b/i)?.[1]);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
}
