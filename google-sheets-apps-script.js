const SHEET_NAME = 'Signups';
const HEADERS = [
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
];

function doPost(event) {
  const lock = LockService.getScriptLock();
  const sheet = getSheet();
  const params = event.parameter || {};
  const row = HEADERS.map((header) => params[header] || '');

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

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  return sheet;
}
