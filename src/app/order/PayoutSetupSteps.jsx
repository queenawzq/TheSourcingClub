/**
 * The steps of adding a withdrawal method, each on its own, the way Upwork does
 * it: the bank form, whose fields come from Wise (api/wise-requirements.js), and
 * PayPal's address. The bank form falls back to the snapshot it carries when
 * Wise cannot be reached, so it is never blank; Wise then checks the details
 * when staff pay, and refuses in words on the board.
 *
 * The number stays in this component until it goes to the database, and is typed
 * twice: a typo pays a stranger.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { useUiLanguage } from "../../lib/ui-language.js";
import { registrationNumberProblem, registrationProblemText } from "../../shared/registration-number.mjs";
import { WISE_FORM_SNAPSHOT } from "../../shared/wise-form-snapshot.mjs";
import { REQUIRED, chosenBankName, inEnglish, wiseBankList, wiseFieldError } from "../../shared/wise-form-check.mjs";
import { normalBankNumber, validBankNumber, validSwift } from "../../shared/bank-fields.mjs";
import { OPERATIONS_EMAIL, PayoutModal, reEnter, transferName } from "./StripePayoutCard.jsx";
import { paypalEmail, validPaypalEmail } from "./use-manual-payouts.js";

/** The factory's screens are English, so the form is too: Wise's English labels, never both languages side by side. */
const BANK_WORDS = {
  titleEdit: "Edit bank account",
  titleFinish: "Add your full account number",
  bankName: "Bank name",
  again: "Re-enter account number",
  numberMismatch: "The two account numbers don't match.",
  numberFormat: "Letters and digits only, 5 to 34 characters.",
  numberStored: (last4) => `Ending ${last4}`,
  back: "Back",
  save: "Save",
  saving: "Saving…",
  loading: "Loading…",
};

async function requirementsFrom(country, details) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/wise-requirements", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ country, details }),
  });
  const result = await response.json();
  if (!response.ok || result.unavailable || !result.fields?.length) throw new Error("unavailable");
  return result;
}

/** What a saved row already says, in the form's own keys. */
function startingValues(row) {
  const saved = row?.wise_details ?? {};
  return {
    ...(row?.account_name ? { accountHolderName: row.account_name } : {}),
    ...(row?.swift ? { swiftCode: row.swift } : {}),
    ...saved,
  };
}

const fieldLabel = (field) => [field.label, inEnglish(field) && field.kind !== "select" ? "(English)" : null].filter(Boolean).join(" ");

const withoutChinese = (text) => (typeof text === "string" ? text.replace(/\s*[\u3400-\u9fff].*$/u, "") : text);
export function WiseBankStep({ row, country, busy, saveWise, onBack, onClose, onUnavailable }) {
  const words = BANK_WORDS;
  const say = withoutChinese;
  const [form, setForm] = useState(country === "CN" ? WISE_FORM_SNAPSHOT : null);
  const [values, setValues] = useState(() => startingValues(row));
  const [bankName, setBankName] = useState(row?.bank_name ?? "");
  const [number, setNumber] = useState("");
  const [numberAgain, setNumberAgain] = useState("");
  const [touched, setTouched] = useState({});
  const [pressed, setPressed] = useState(false);
  const [problem, setProblem] = useState(null);

  // Never blank: anything but Wise's answer draws the snapshot, which is China's
  // form. Another country goes to the plain bank form instead.
  const load = async (details) => {
    try {
      setForm(await requirementsFrom(country, details));
    } catch {
      if (country === "CN") setForm((current) => current ?? WISE_FORM_SNAPSHOT);
      else if (!form) onUnavailable?.();
    }
  };
  useEffect(() => { load(); /* once, for this row */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasStoredNumber = Boolean(row?.number_changed_at);
  const typed = normalBankNumber(number);
  const numberField = form?.fields.find((field) => field.key === form.numberKey);
  const otherFields = form?.fields.filter((field) => field.key !== form.numberKey) ?? [];
  // Hong Kong: Wise's form already asks which bank, so "Bank name" is asked once.
  const bankList = wiseBankList(otherFields);
  const savedBankName = bankList ? chosenBankName(bankList, values[bankList.key]) : bankName;

  const fieldError = (field) => wiseFieldError(field, values[field.key]);
  const numberError = !typed
    ? hasStoredNumber ? null : REQUIRED
    : !validBankNumber(typed) ? words.numberFormat : null;
  const againError = (typed || numberAgain) && typed !== normalBankNumber(numberAgain) ? words.numberMismatch : null;
  const bankError = bankList || bankName.trim() ? null : REQUIRED;
  const anyError = !form || bankError || numberError || againError || otherFields.some(fieldError);
  const shown = (key, error) => ((pressed || touched[key]) ? error : null);
  const leave = (key) => () => setTouched((current) => ({ ...current, [key]: true }));

  async function save() {
    setPressed(true);
    setProblem(null);
    if (anyError) return;
    const details = { ...(form.fixed ?? {}) };
    for (const field of otherFields) details[field.key] = values[field.key].trim();
    try {
      await saveWise({
        bankName: savedBankName, type: form.type, currency: form.currency, details,
        numberKey: form.numberKey, number, numberAgain,
      });
    } catch (failure) {
      setProblem(failure);
    }
  }

  const change = (field) => (event) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [field.key]: value }));
    // Wise adds or drops fields on some answers.
    if (field.refresh) load({ ...(form.fixed ?? {}), [field.key]: value });
  };

  return (
    <PayoutModal
      keepOpen
      title={!row ? transferName(country) : row.number_changed_at ? words.titleEdit : words.titleFinish}
      onClose={onClose}
      actions={<>
        {problem ? <p className="live-stripe-error payout-modal-refusal" role="alert">{problem.message}</p> : null}
        <button className="secondary-btn" type="button" disabled={busy} onClick={onBack}>{words.back}</button>
        <button className="primary-btn" type="button" data-testid="save-payout" disabled={busy || !form} onClick={save}>{busy ? words.saving : words.save}</button>
      </>}
    >
      {!form ? <p className="payout-modal-intro" role="status">{words.loading}</p> : (
        <div className="payout-form-stack">
          {bankList ? null : <label>
            <span>{words.bankName} *</span>
            <input data-field="payout_bank_name" value={bankName} onBlur={leave("bank")} onChange={(event) => setBankName(event.target.value)} />
            {shown("bank", bankError) ? <small className="live-stripe-error" role="alert">{say(bankError)}</small> : null}
          </label>}
          {otherFields.map((field) => (
            <label key={field.key}>
              <span>{say(fieldLabel(field))} *</span>
              {field.kind === "select" ? (
                <select data-field={`wise_${field.key}`} value={values[field.key] ?? ""} onBlur={leave(field.key)} onChange={change(field)}>
                  <option value="" />
                  {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input data-field={`wise_${field.key}`} value={values[field.key] ?? ""} maxLength={field.maxLength}
                       placeholder={field.example ?? ""}
                       onBlur={leave(field.key)} onChange={change(field)} />
              )}
              {shown(field.key, fieldError(field)) ? <small className="live-stripe-error" role="alert">{say(fieldError(field))}</small> : null}
            </label>
          ))}
          <label>
            <span>{numberField ? say(fieldLabel(numberField)) : ""} {hasStoredNumber ? "" : "*"}</span>
            <input data-field="payout_account_number" autoComplete="off" spellCheck={false} value={number}
                   placeholder={hasStoredNumber ? words.numberStored(row.account_number_last4) : numberField?.example ?? ""}
                   onBlur={leave("number")} onChange={(event) => setNumber(event.target.value)} />
            {shown("number", numberError) ? <small className="live-stripe-error" role="alert">{say(numberError)}</small> : null}
          </label>
          <label>
            <span>{numberField ? reEnter(say(numberField.label)) : words.again} {hasStoredNumber && !typed ? "" : "*"}</span>
            <input data-field="payout_account_number_again" autoComplete="off" spellCheck={false} value={numberAgain}
                   onBlur={leave("again")} onChange={(event) => setNumberAgain(event.target.value)} />
            {shown("again", againError) ? <small className="live-stripe-error" role="alert">{againError}</small> : null}
          </label>
        </div>
      )}
    </PayoutModal>
  );
}

/**
 * Tazapay's bank form for mainland China and Hong Kong: WiseBankStep's frame,
 * Tazapay's fixed field list (src/shared/tazapay-payout.mjs checks the same
 * fields when staff pay). The company's USCC is shown, not asked, when TSC
 * already has it: Tazapay refuses any other number.
 */
const TAZAPAY_WORDS = {
  ...BANK_WORDS,
  holderEnglish: "Account holder name (English)",
  holderChinese: "Account holder name (Chinese)",
  uscc: "Unified Social Credit Code",
  number: "Account number",
  street: "Street address",
  city: "City",
  district: "District",
  bankCode: "Bank code",
  swift: "SWIFT code",
  notLatin: "Use English letters",
  notChinese: "Use Chinese characters, as your bank has the name",
  bankCodeFormat: "3 digits, for example 004",
  swiftFormat: "8 or 11 letters and digits, for example HSBCHKHH",
  // A function: StripePayoutCard imports this file, so its constant is read at render, not at load.
  usccNotOnFile: () => `TSC pays this account only once this code matches your company's business registration on TSC. If TSC doesn't have it, contact TSC operations at ${OPERATIONS_EMAIL} to add it.`,
};
// Stored in English (Tazapay's address); labelled in the reader's language. The
// language layer leaves a select's own text alone, so the options are drawn here.
const HK_DISTRICTS = [["Hong Kong Island", "香港岛"], ["Kowloon", "九龙"], ["New Territories", "新界"]];
const isLatinName = (value) => /^[\x20-\x7EÀ-ɏ’]+$/.test(value) && /[A-Za-zÀ-ɏ]/.test(value);

export function TazapayBankStep({ row, country, busy, companyRegistration = null, save, onBack, onClose }) {
  const words = TAZAPAY_WORDS;
  const hk = country === "HK";
  const zh = useUiLanguage() === "zh";
  const [values, setValues] = useState(() => ({
    bank_name: row?.bank_name ?? "",
    account_name: row?.account_name ?? "",
    holder_name_local: row?.holder_name_local ?? "",
    registration_number: row?.registration_number ?? "",
    bank_code: row?.bank_code ?? "",
    swift: row?.swift ?? "",
    address_line1: row?.address_line1 ?? "",
    address_city: row?.address_city ?? "",
    address_state: row?.address_state ?? "",
  }));
  const [number, setNumber] = useState("");
  const [numberAgain, setNumberAgain] = useState("");
  const [touched, setTouched] = useState({});
  const [pressed, setPressed] = useState(false);
  const [problem, setProblem] = useState(null);

  const hasStoredNumber = Boolean(row?.number_changed_at);
  const typed = normalBankNumber(number);
  const v = (key) => (values[key] ?? "").trim();
  const errors = {
    bank_name: v("bank_name") ? null : REQUIRED,
    account_name: !v("account_name") ? REQUIRED : isLatinName(v("account_name")) ? null : words.notLatin,
    holder_name_local: hk ? null : !v("holder_name_local") ? REQUIRED : /[㐀-鿿]/.test(v("holder_name_local")) && v("holder_name_local").length >= 2 && v("holder_name_local").length <= 140 ? null : words.notChinese,
    // The server refuses a bad number by a constraint; say why at the field instead.
    registration_number: hk || companyRegistration ? null : !v("registration_number") ? REQUIRED
      : registrationNumberProblem("CN", v("registration_number")) ? registrationProblemText("CN", registrationNumberProblem("CN", v("registration_number")), zh ? "zh" : "en") : null,
    bank_code: !hk ? null : !v("bank_code") ? REQUIRED : /^\d{3}$/.test(v("bank_code")) ? null : words.bankCodeFormat,
    swift: !hk ? null : !v("swift") ? REQUIRED : validSwift(v("swift")) ? null : words.swiftFormat,
    address_line1: v("address_line1") ? null : REQUIRED,
    address_city: hk ? null : v("address_city") ? null : REQUIRED,
    address_state: !hk ? null : v("address_state") ? null : REQUIRED,
    number: !typed ? (hasStoredNumber ? null : REQUIRED) : !validBankNumber(typed) ? words.numberFormat : null,
    again: (typed || numberAgain) && typed !== normalBankNumber(numberAgain) ? words.numberMismatch : null,
  };
  const anyError = Object.values(errors).some(Boolean);
  const shown = (key) => ((pressed || touched[key]) ? errors[key] : null);
  const leave = (key) => () => setTouched((current) => ({ ...current, [key]: true }));
  const set = (key, transform = (x) => x) => (event) => { const value = transform(event.target.value); setValues((current) => ({ ...current, [key]: value })); };
  const upperOnBlur = (key) => () => { leave(key)(); setValues((current) => ({ ...current, [key]: (current[key] ?? "").toUpperCase().trim() })); };

  async function submit() {
    setPressed(true);
    setProblem(null);
    if (anyError) return;
    try {
      await save({
        bank_country: country,
        bank_name: v("bank_name"),
        account_name: v("account_name"),
        holder_name_local: hk ? null : v("holder_name_local"),
        registration_number: hk ? null : companyRegistration ?? v("registration_number"),
        bank_code: hk ? v("bank_code") : null,
        swift: hk ? v("swift") : null,
        address_line1: v("address_line1"),
        address_city: hk ? null : v("address_city"),
        address_state: hk ? v("address_state") : null,
        account_number: number,
        account_number_again: numberAgain,
      });
    } catch (failure) {
      setProblem(failure);
    }
  }

  const field = (key, label, input) => (
    <label key={key}>
      <span>{label} *</span>
      {input}
      {shown(key) ? <small className="live-stripe-error" role="alert">{shown(key)}</small> : null}
    </label>
  );
  const text = (key, extra = {}) => (
    <input data-field={`tazapay_${key}`} value={values[key]} onBlur={leave(key)} onChange={set(key)} {...extra} />
  );
  const numberFields = [
    field("number", words.number, (
      <input data-field="payout_account_number" autoComplete="off" spellCheck={false} value={number}
             placeholder={hasStoredNumber ? words.numberStored(row.account_number_last4) : ""}
             onBlur={leave("number")} onChange={(event) => setNumber(event.target.value)} />
    )),
    field("again", reEnter(words.number), (
      <input data-field="payout_account_number_again" autoComplete="off" spellCheck={false} value={numberAgain}
             onBlur={leave("again")} onChange={(event) => setNumberAgain(event.target.value)} />
    )),
  ];

  return (
    <PayoutModal
      keepOpen
      title={!row ? "Bank transfer" : row.number_changed_at ? words.titleEdit : words.titleFinish}
      onClose={onClose}
      actions={<>
        {problem ? <p className="live-stripe-error payout-modal-refusal" role="alert">{problem.message}</p> : null}
        <button className="secondary-btn" type="button" disabled={busy} onClick={onBack}>{words.back}</button>
        <button className="primary-btn" type="button" data-testid="save-payout" disabled={busy} onClick={submit}>{busy ? words.saving : words.save}</button>
      </>}
    >
      <div className="payout-form-stack">
        {field("bank_name", words.bankName, text("bank_name"))}
        {hk ? <>
          {field("bank_code", words.bankCode, text("bank_code", { inputMode: "numeric", maxLength: 3, placeholder: "004" }))}
          {field("swift", words.swift, text("swift", { placeholder: "HSBCHKHH", onBlur: upperOnBlur("swift") }))}
          {field("account_name", words.holderEnglish, text("account_name"))}
          {numberFields}
          {field("address_line1", words.street, text("address_line1", { maxLength: 140 }))}
          {field("address_state", words.district, (
            <select data-field="tazapay_address_state" value={values.address_state} onBlur={leave("address_state")} onChange={set("address_state")}>
              <option value="" />
              {HK_DISTRICTS.map(([name, nameZh]) => <option key={name} value={name}>{zh ? nameZh : name}</option>)}
            </select>
          ))}
        </> : <>
          {field("account_name", words.holderEnglish, text("account_name"))}
          {field("holder_name_local", words.holderChinese, text("holder_name_local"))}
          {companyRegistration ? (
            <label key="uscc">
              <span>{words.uscc}</span>
              <span className="payout-readonly-value" data-field="tazapay_registration_number" style={{ overflowWrap: "anywhere" }}>{companyRegistration}</span>
            </label>
          ) : <>
            {field("registration_number", words.uscc, text("registration_number", { onBlur: upperOnBlur("registration_number") }))}
            {/* No registration on file: Tazapay pays only an account in the company's own name, checked against it. */}
            <small>{words.usccNotOnFile()}</small>
          </>}
          {numberFields}
          {field("address_line1", words.street, text("address_line1", { maxLength: 140 }))}
          {field("address_city", words.city, text("address_city", { maxLength: 80 }))}
        </>}
      </div>
    </PayoutModal>
  );
}

const PAYPAL_WORDS = {
  title: "PayPal", titleEdit: "Edit PayPal account", email: "PayPal email", again: "Re-enter email",
  invalid: "Enter a valid email address.", mismatch: "The two email addresses don't match.",
  back: "Back", save: "Save", saving: "Saving…",
};

export function PaypalStep({ row, country, form, busy, onField, savePaypal, onBack, onClose }) {
  const words = PAYPAL_WORDS;
  const [left, setLeft] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [problem, setProblem] = useState(null);
  const invalid = !validPaypalEmail(form.paypal_email);
  const mismatch = paypalEmail(form.paypal_email) !== paypalEmail(form.paypal_email_confirm);

  async function save() {
    setPressed(true);
    setProblem(null);
    if (invalid || mismatch) return;
    try {
      await savePaypal();
    } catch (failure) {
      setProblem(failure);
    }
  }

  return (
    <PayoutModal
      keepOpen
      title={row ? words.titleEdit : words.title}
      onClose={onClose}
      actions={<>
        {problem ? <p className="live-stripe-error payout-modal-refusal" role="alert">{problem.message}</p> : null}
        <button className="secondary-btn" type="button" disabled={busy} onClick={onBack}>{words.back}</button>
        <button className="primary-btn" type="button" data-testid="save-payout" disabled={busy} onClick={save}>{busy ? words.saving : words.save}</button>
      </>}
    >
      <div className="payout-form-stack">
        <label>
          <span>{words.email} *</span>
          <input type="email" autoComplete="off" data-field="payout_paypal_email" value={form.paypal_email} onBlur={() => setLeft(true)} onChange={onField("paypal_email")} />
          {(left || pressed) && invalid ? <small className="live-stripe-error" role="alert">{words.invalid}</small> : null}
        </label>
        <label>
          <span>{words.again} *</span>
          <input type="email" autoComplete="off" data-field="payout_paypal_email_confirm" value={form.paypal_email_confirm} onChange={onField("paypal_email_confirm")} />
          {pressed && mismatch ? <small className="live-stripe-error" role="alert">{words.mismatch}</small> : null}
        </label>
      </div>
    </PayoutModal>
  );
}
