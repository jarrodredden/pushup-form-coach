const SPREADSHEET_ID = '1xncvpxe7yjDadtHkOncha0sag4L26KIBQTw7TrnZ0es';
const SHEET_NAME = 'Results';

function ensureSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'volunteer_name', 'mode', 'attempt1_score', 'attempt2_score', 'delta', 'reps', 'notes_summary', 'device_user_agent']);
  }
  return sheet;
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
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
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
