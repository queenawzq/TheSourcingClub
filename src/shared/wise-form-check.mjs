/**
 * What the bank form checks before saving. Wise's own rules travel with its
 * form; the name's rule is also the database's (payout_name_is_latin). Wise
 * requires Latin letters for CNY to a company, and the address goes on the same
 * transfer, so both are asked for in English and refused in both languages.
 * Said in both: the reader may read only Chinese.
 */
export const isLatinText = (value) => {
  const text = value ?? "";
  return !/[^ -~À-ɏ’]/.test(text) && /[A-Za-zÀ-ɏ]/.test(text);
};

export const inEnglish = (field) => field.key === "accountHolderName" || field.key.startsWith("address.");

export const REQUIRED = "Required 必填";

/** The error for one of Wise's fields, or null. A pattern we cannot read checks nothing. */
export function wiseFieldError(field, raw) {
  const value = (raw ?? "").trim();
  if (!value) return REQUIRED;
  if (field.kind !== "select" && inEnglish(field) && !isLatinText(value)) return "Use English letters 请用英文填写";
  if (field.minLength && value.length < field.minLength) return `At least ${field.minLength} characters 至少 ${field.minLength} 个字符`;
  if (field.maxLength && value.length > field.maxLength) return `At most ${field.maxLength} characters 最多 ${field.maxLength} 个字符`;
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value)) return `Check this field 请检查此项${field.example ? `: ${field.example}` : ""}`;
    } catch {
      return null;
    }
  }
  return null;
}
