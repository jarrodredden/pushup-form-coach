const SPREADSHEET_ID = '1xncvpxe7yjDadtHkOncha0sag4L26KIBQTw7TrnZ0es';
const SHEET_NAME = 'Results';
const CONSENT_SHEET_NAME = 'Consents';

const RESULT_COLUMNS = [
  'timestamp',
  'volunteer_name',
  'mode',
  'attempt1_score',
  'attempt2_score',
  'delta',
  'reps',
  'notes_summary',
  'device_user_agent',
  'set1_feedback',
  'set2_feedback',
  'camera_view',
  'tempo_cues',
  'session_id',
];

// Writes by header name. Columns missing from an existing sheet are added at the right, so older
// rows keep their layout and new fields land under their own headers.
function ensureSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(RESULT_COLUMNS);
    return { sheet: sheet, headers: RESULT_COLUMNS.slice() };
  }
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  const missing = RESULT_COLUMNS.filter((name) => headers.indexOf(name) === -1);
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    missing.forEach((name) => headers.push(name));
  }
  return { sheet: sheet, headers: headers };
}

// The app retries until it hears back, so the same session can arrive more than once.
function hasSession_(sheet, headers, sessionId) {
  const column = headers.indexOf('session_id');
  if (!sessionId || column === -1 || sheet.getLastRow() < 2) return false;
  return Boolean(
    sheet
      .getRange(2, column + 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(String(sessionId))
      .matchEntireCell(true)
      .findNext(),
  );
}

function ensureConsentSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONSENT_SHEET_NAME) || spreadsheet.insertSheet(CONSENT_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['uploaded_at', 'signed_at', 'participant_name', 'signer_name', 'signer_role', 'file_name', 'file_url', 'consent_id']);
  }
  return sheet;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Signed consent PDFs go in the same Drive folder as the results spreadsheet.
function consentFolder_() {
  const parents = DriveApp.getFileById(SPREADSHEET_ID).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

function safeFileName_(name) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return /\.pdf$/i.test(cleaned) ? cleaned : (cleaned || 'consent') + '.pdf';
}

function saveConsentPdf_(payload) {
  if (!payload.pdf_base64) throw new Error('Missing pdf_base64');
  const folder = consentFolder_();
  const fileName = safeFileName_(payload.filename);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // A retried upload of the same consent (same timestamped name) reuses the file instead of duplicating it.
    const existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      const file = existing.next();
      return { ok: true, type: 'consent_pdf', fileId: file.getId(), url: file.getUrl(), name: fileName, duplicate: true };
    }
    const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(payload.pdf_base64), 'application/pdf', fileName));
    file.setDescription('Consent ID ' + (payload.consent_id || '') + ' · participant ' + (payload.participant_name || ''));
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    ensureConsentSheet_(spreadsheet).appendRow([
      new Date().toISOString(),
      payload.signed_at || '',
      payload.participant_name || '',
      payload.signer_name || '',
      payload.signer_role || '',
      fileName,
      file.getUrl(),
      payload.consent_id || '',
    ]);
    return { ok: true, type: 'consent_pdf', fileId: file.getId(), url: file.getUrl(), name: fileName };
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.type === 'consent_pdf') {
      return json_(saveConsentPdf_(payload));
    }
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const target = ensureSheet_(spreadsheet);
      if (hasSession_(target.sheet, target.headers, payload.session_id)) {
        return json_({ ok: true, duplicate: true });
      }
      target.sheet.appendRow(target.headers.map((name) => (payload[name] === undefined || payload[name] === null ? '' : payload[name])));
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

// Creating (then trashing) a real file makes the editor ask for the full Drive scope that
// createFile needs; only reading the folder grants too little.
// After pulling a new Code.gs: paste it in, run authorizeDrive once and approve, then
// Deploy → Manage deployments → edit → Version: New version → Deploy (same /exec URL).
function authorizeDrive() {
  const folder = consentFolder_();
  const probe = folder.createFile(Utilities.newBlob('consent upload permission check', 'text/plain', 'consent-permission-check.txt'));
  probe.setTrashed(true);
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  Logger.log('Drive create access OK. Consent PDFs will be saved to: ' + folder.getName() + ' (' + folder.getUrl() + ')');
}
