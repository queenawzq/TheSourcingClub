/**
 * Wise's account requirements, reduced to the form a factory fills in.
 *
 * Wise says what a bank account needs for a currency, so its rules arrive with
 * the key change rather than a code change. Only what Wise requires is asked.
 * Never asked of a factory: Wise's CNY declaration, which staff make when they
 * pay; a select with one possible value; a country the factory already told us.
 */
const NEVER_ASKED = new Set(["isContractDenotedInCny"]);
const NUMBER_KEYS = /^(accountNumber|iban|IBAN|cardNumber|clabe)$/;
const WALLETS = /alipay|wechat|fps|email|card/i;

/** The bank-to-a-company kind of recipient, whatever else Wise offers beside it. */
export function chooseRecipientType(types) {
  const banks = (Array.isArray(types) ? types : []).filter((type) => type?.type && !WALLETS.test(type.type));
  return banks.find((type) => /local_business/.test(type.type))
    ?? banks.find((type) => /business/.test(type.type))
    ?? banks.find((type) => !/hong_?kong/i.test(type.type))
    ?? null;
}

/**
 * { type, numberKey, fixed, fields }, or null when it is not a form we can
 * safely draw: no account number to keep in Vault, or a second one that would
 * land in the open column.
 */
export function formFromRequirements(type, knownCountry) {
  if (!type?.type) return null;
  const fixed = {};
  const fields = [];
  let numberKey = null;
  for (const group of (type.fields ?? []).flatMap((field) => field.group ?? [])) {
    const { key } = group;
    if (!key || NEVER_ASKED.has(key)) continue;
    if (key === "address.country" && knownCountry) { fixed[key] = knownCountry; continue; }
    if (group.valuesAllowed?.length === 1) { fixed[key] = group.valuesAllowed[0].key; continue; }
    if (NUMBER_KEYS.test(key) && group.required) {
      if (numberKey) return null;
      numberKey = key;
    }
    if (!group.required) continue;
    fields.push({
      key,
      label: String(group.name ?? key).trim(),
      kind: group.valuesAllowed?.length ? "select" : "text",
      options: group.valuesAllowed?.length ? group.valuesAllowed.map((option) => ({ value: option.key, label: option.name })) : undefined,
      example: group.example || undefined,
      minLength: group.minLength ?? undefined,
      maxLength: group.maxLength ?? undefined,
      pattern: group.validationRegexp || undefined,
      refresh: group.refreshRequirementsOnChange ? true : undefined,
    });
  }
  if (!numberKey || !fields.some((field) => field.key === "accountHolderName")) return null;
  return { type: type.type, numberKey, fixed, fields };
}
