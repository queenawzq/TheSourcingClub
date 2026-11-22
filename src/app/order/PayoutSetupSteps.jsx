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
import { WISE_FORM_SNAPSHOT } from "../../shared/wise-form-snapshot.mjs";
import { REQUIRED, chosenBankName, inEnglish, wiseBankList, wiseFieldError } from "../../shared/wise-form-check.mjs";
import { normalBankNumber, validBankNumber } from "../../shared/bank-fields.mjs";
import { ModalMessage, PayoutModal, reEnter, transferName } from "./StripePayoutCard.jsx";
import { paypalEmail, validPaypalEmail } from "./use-manual-payouts.js";

/** The factory's screens are English, so the form is too: Wise's English labels, never both languages side by side. */
const BANK_WORDS = {
  titleEdit: "Edit bank account",
  titleFinish: "Add your full account number",
  bankName: "Bank name",
  again: "Re-enter account number",
  numberMismatch: "The two account numbers don't match.",
  numberFormat: "Letters and digits only, 5 to 34 characters.",
  ibanInvalid: "This IBAN isn't valid. Check each character.",
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

/**
 * An IBAN's own check (ISO 13616, mod 97): a mistyped character is caught
 * here, before it is saved, instead of when staff pay. It cannot tell whether
 * the bank exists; Wise still checks that.
 */
export function validIban(value) {
  const iban = normalBankNumber(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let rest = 0;
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  return rest === 1;
}
const isIbanField = (field) => /iban/i.test(`${field?.key ?? ""} ${field?.label ?? ""}`);

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
  // An edit asks for the saved recipient's own form (a business is asked for
  // "Name of the business / organisation", as when it was added).
  useEffect(() => { load(row?.wise_details?.legalType ? { legalType: row.wise_details.legalType } : undefined); /* once, for this row */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    : !validBankNumber(typed) ? words.numberFormat
    : isIbanField(numberField) && !validIban(typed) ? words.ibanInvalid : null;
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
        <button className="secondary-btn" type="button" disabled={busy} onClick={onBack}>{words.back}</button>
        <button className="primary-btn" type="button" data-testid="save-payout" disabled={busy || !form} onClick={save}>{busy ? words.saving : words.save}</button>
      </>}
    >
      {problem ? <ModalMessage>{problem.message}</ModalMessage> : null}
      {!form ? <p className="payout-modal-intro" role="status">{words.loading}</p> : (
        <div className="payout-form-stack">
          {bankList ? null : <label>
            <span>{words.bankName} *</span>
            <input data-field="payout_bank_name" aria-label={words.bankName} value={bankName} onBlur={leave("bank")} onChange={(event) => setBankName(event.target.value)} />
            {shown("bank", bankError) ? <small className="live-stripe-error" role="alert">{say(bankError)}</small> : null}
          </label>}
          {otherFields.map((field) => (
            <label key={field.key}>
              <span>{say(fieldLabel(field))} *</span>
              {field.kind === "select" ? (
                <select data-field={`wise_${field.key}`} aria-label={say(field.label)} value={values[field.key] ?? ""} onBlur={leave(field.key)} onChange={change(field)}>
                  <option value="" />
                  {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input data-field={`wise_${field.key}`} aria-label={say(field.label)} value={values[field.key] ?? ""} maxLength={field.maxLength}
                       placeholder={field.example ?? ""}
                       onBlur={leave(field.key)} onChange={change(field)} />
              )}
              {shown(field.key, fieldError(field)) ? <small className="live-stripe-error" role="alert">{say(fieldError(field))}</small> : null}
            </label>
          ))}
          <label>
            <span>{numberField ? say(fieldLabel(numberField)) : ""} {hasStoredNumber ? "" : "*"}</span>
            <input data-field="payout_account_number" aria-label={numberField ? say(numberField.label) : "Account number"} autoComplete="off" spellCheck={false} value={number}
                   placeholder={hasStoredNumber ? words.numberStored(row.account_number_last4) : numberField?.example ?? ""}
                   onBlur={leave("number")} onChange={(event) => setNumber(event.target.value)} />
            {shown("number", numberError) ? <small className="live-stripe-error" role="alert">{say(numberError)}</small> : null}
          </label>
          <label>
            <span>{numberField ? reEnter(say(numberField.label)) : words.again} {hasStoredNumber && !typed ? "" : "*"}</span>
            <input data-field="payout_account_number_again" aria-label={numberField ? reEnter(say(numberField.label)) : words.again} autoComplete="off" spellCheck={false} value={numberAgain}
                   onBlur={leave("again")} onChange={(event) => setNumberAgain(event.target.value)} />
            {shown("again", againError) ? <small className="live-stripe-error" role="alert">{againError}</small> : null}
          </label>
        </div>
      )}
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
        <button className="secondary-btn" type="button" disabled={busy} onClick={onBack}>{words.back}</button>
        <button className="primary-btn" type="button" data-testid="save-payout" disabled={busy} onClick={save}>{busy ? words.saving : words.save}</button>
      </>}
    >
      {problem ? <ModalMessage>{problem.message}</ModalMessage> : null}
      <div className="payout-form-stack">
        <label>
          <span>{words.email} *</span>
          <input type="email" autoComplete="off" data-field="payout_paypal_email" aria-label={PAYPAL_WORDS.email} value={form.paypal_email} onBlur={() => setLeft(true)} onChange={onField("paypal_email")} />
          {(left || pressed) && invalid ? <small className="live-stripe-error" role="alert">{words.invalid}</small> : null}
        </label>
        <label>
          <span>{words.again} *</span>
          <input type="email" autoComplete="off" data-field="payout_paypal_email_confirm" aria-label={PAYPAL_WORDS.again} value={form.paypal_email_confirm} onChange={onField("paypal_email_confirm")} />
          {pressed && mismatch ? <small className="live-stripe-error" role="alert">{words.mismatch}</small> : null}
        </label>
      </div>
    </PayoutModal>
  );
}
