const SPREADSHEET_ID = '1xncvpxe7yjDadtHkOncha0sag4L26KIBQTw7TrnZ0es';
const SHEET_NAME = 'Results';
const CONSENT_SHEET_NAME = 'Consents';

function ensureSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'volunteer_name', 'mode', 'attempt1_score', 'attempt2_score', 'delta', 'reps', 'notes_summary', 'device_user_agent']);
  }
  return sheet;
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
    const sheet = ensureSheet_(spreadsheet);
    sheet.appendRow([
      payload.timestamp || '',
      payload.volunteer_name || '',
      payload.mode || '',
      payload.attempt1_score ?? '',
      payload.attempt2_score ?? '',
      payload.delta ?? '',
      payload.reps ?? '',
      payload.notes_summary || '',
      payload.device_user_agent || '',
    ]);
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

// Run once from the Apps Script editor to grant the Drive permission before redeploying.
function authorizeDrive() {
  const folder = consentFolder_();
  Logger.log('Consent PDFs will be saved to: ' + folder.getName() + ' (' + folder.getUrl() + ')');
}
