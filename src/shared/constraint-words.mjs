/**
 * A value the database refused (a check constraint, Postgres code 23514), in
 * words a person can act on, in English or Chinese. The raw message names a
 * table and a constraint ("violates check constraint
 * factory_profiles_founded_year_check"), which nobody filling in a form can
 * use. unwrap() (src/lib/supabase.js) uses it for every save.
 */

// Columns a person types, by the end of their constraint's name.
const FIELDS = {
  founded_year: null, // its own sentence below
  employee_count: ["total employees", "员工总数"],
  partner_factory_count: ["partner factories", "合作工厂数量"],
  moq: ["minimum order quantity", "最小起订量"],
  typical_lead_days: ["lead time", "交货期"],
  sample_lead_days: ["sample lead time", "打样周期"],
  bulk_lead_time_days: ["bulk lead time", "大货交期"],
  bulk_lead_time_max_days: ["bulk lead time", "大货交期"],
  capacity_window_units: ["capacity", "产能"],
  production_quantity: ["quantity", "数量", "positive"],
  quantity_total: ["quantity", "数量", "positive"],
  unit_price_cents: ["unit price", "单价"],
  unit_price_max_cents: ["unit price", "单价"],
  target_unit_price_min_cents: ["target price", "目标价格"],
  target_unit_price_max_cents: ["target price", "目标价格"],
  target_price_min_cents: ["target price", "目标价格"],
  target_price_max_cents: ["target price", "目标价格"],
};

/** The constraint's name, from the error's message or details. */
export function constraintName(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return text.match(/check constraint "?([a-z0-9_]+)"?/i)?.[1] ?? null;
}

/** Words for a refused value, or null when the error is not a check constraint. */
export function constraintInWords(error, language = "en") {
  // A function's own refusal with this code (the last owner) has its own words.
  const name = String(error?.code ?? "") === "23514" ? constraintName(error) : null;
  if (!name) return null;
  const zh = language === "zh";
  if (/founded_year_check$/.test(name)) {
    return zh ? "请以4位数字填写成立年份，例如 2016。" : "Enter the year founded as 4 digits, like 2016.";
  }
  if (/(production_address|address)_check$/.test(name)) {
    return zh ? "地址过长，请控制在500个字符以内。" : "The address is too long. Use 500 characters or fewer.";
  }
  const column = Object.keys(FIELDS).find((key) => FIELDS[key] && name.endsWith(`_${key}_check`));
  if (column) {
    const [en, cn, positive] = FIELDS[column];
    if (positive) return zh ? `${cn}请填写大于0的数字。` : `Enter more than 0 for ${en}.`;
    return zh ? `${cn}请填写0或以上的数字。` : `Enter 0 or more for ${en}.`;
  }
  if (/_ordered$/.test(name)) {
    return zh ? "最小值不能大于最大值。" : "The lowest value can't be more than the highest.";
  }
  return zh ? "有一项内容未被接受，请检查填写的数字和日期。" : "One of the values wasn't accepted. Check the numbers and dates you entered.";
}

/** The page's language as <html lang> says, for code that has no language of its own. */
export function pageLanguage() {
  return /^zh/i.test(globalThis.document?.documentElement?.lang ?? "") ? "zh" : "en";
}
