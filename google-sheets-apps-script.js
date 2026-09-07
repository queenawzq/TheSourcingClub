/**
 * Google Apps Script Web App backing the marketing signup forms and — when the
 * site is NOT hosted on Netlify — the factory prototype survey.
 *
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app,
 * "Execute as: Me", "Who has access: Anyone". The /exec URL it returns is the
 * one hardcoded in script.js and survey.js.
 *
 * Requests are routed by the `source` field each form sends. Unknown sources
 * fall back to the signup sheet so older forms keep working.
 */
const FORMS = {
  signup: {
    sheet: 'Signups',
    headers: [
      'submittedAt',
      'source',
      'name',
      'email',
      'brand',
      'company',
      'region',
      'category',
      'helpType',
      'page'
    ]
  },
  'factory-prototype-survey': {
    sheet: 'FactorySurvey',
    headers: [
      'submittedAt',
      'source',
      'page',
      'participant_name',
      'factory_name',
      'participant_role',
      'contact',
      'project_quote_worth_clarity',
      'info_needed_before_quote',
      'quote_form_asks_right_info',
      'quote_form_add_or_change',
      'real_quote_behavior',
      'rfq_action_clarity',
      'project_next_step_clarity',
      'capacity_hours_match',
      'capacity_easier_input_method',
      'monthly_capacity_update_likelihood',
      'trust_factors',
      'trust_factors_other',
      'one_thing_to_improve',
      'overall_feedback'
    ]
  }
};

function doPost(event) {
  // `parameters` (plural) gives every value per field, which matters for the
  // survey's checkbox group; `parameter` would silently keep only the first.
  const params = (event && event.parameters) || {};
  const source = readField(params, 'source') || readField(params, 'form-name');
  const config = FORMS[source] || FORMS.signup;

  const sheet = getSheet(config);
  const row = config.headers.map((header) => readField(params, header));

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function readField(params, key) {
  const values = params[key];
  if (!values || !values.length) return '';
  return values.join(', ');
}

function getSheet(config) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(config.sheet) || spreadsheet.insertSheet(config.sheet);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(config.headers);
  }

  return sheet;
}
