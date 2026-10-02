import type { jsPDF as JsPdfDocument } from 'jspdf';

export type ConsentSignerRole = 'guardian' | 'participant';

export interface ConsentSettings {
  studentResearchers: string;
  projectTitle: string;
  sponsorName: string;
  sponsorContact: string;
}

export const DEFAULT_CONSENT_SETTINGS: ConsentSettings = {
  studentResearchers: '',
  projectTitle: 'AI Camera Push-up Form Coach',
  sponsorName: 'Jarrod Redden',
  sponsorContact: 'Contact through the school',
};

export const CONSENT_SECTIONS: Array<{ label: string; text: string }> = [
  {
    label: 'Purpose of the project',
    text: 'This science fair study tests whether an AI camera push-up form coach helps people improve their push-up form. The app watches each rep through the device camera and scores depth, plank line, and elbow position.',
  },
  {
    label: 'If you participate, you will be asked to',
    text: 'Do 5 push-ups, get brief coaching from the app, then do 5 more push-ups.',
  },
  { label: 'Time required for participation', text: 'About 5–10 minutes.' },
  {
    label: 'Potential risks',
    text: 'Normal exercise fatigue or muscle strain, like any short workout. The device camera records your exercise form during the session so the app can score it; pose tracking runs on the device itself.',
  },
  { label: 'Potential benefits', text: 'Personal feedback on push-up form, and data for a student science fair project.' },
  {
    label: 'How confidentiality will be maintained',
    text: 'Your name and push-up scores may be added to a shared results spreadsheet used only for this project. Signed consent forms are stored in the project’s Google Drive folder. No video is saved, uploaded, or posted publicly.',
  },
];

export const VOLUNTARY_TEXT =
  'Participation in this study is completely voluntary. If you decide not to participate there will not be negative consequences. Please be aware that if you decide to participate, you may stop participating at any time and you may decide not to answer any specific question.';

export const ATTESTATION_TEXT =
  'By signing this form I am attesting that I have read and understand the information above and I freely give my consent/assent to participate or permission for my child to participate.';

export const INTRO_TEXT =
  'I am asking for your voluntary participation in my science fair project. Please read the following information about the project. If you would like to participate, please sign in the appropriate area below.';

export interface ConsentRecord {
  id: string;
  participantName: string;
  signerRole: ConsentSignerRole;
  signerName: string;
  signedAtIso: string;
  signatureDataUrl: string;
  assentSignatureDataUrl: string | null;
  settings: ConsentSettings;
}

export interface SignedConsent {
  id: string;
  participantName: string;
  signerRole: ConsentSignerRole;
  signerName: string;
  signedAtIso: string;
  fileName: string;
  pdfBase64: string;
  uploaded: boolean;
  /** The deployed Apps Script predates consent uploads; only a manual retry re-sends. */
  scriptOutdated?: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** mm/dd/yy, matching the ISEF form's date field. */
export function consentDateLabel(date: Date) {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${String(date.getFullYear()).slice(-2)}`;
}

export function safeFileStem(name: string) {
  const stem = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return stem || 'participant';
}

/** e.g. consent_Connor-Smith_2026-10-01_14-05-09.pdf (local time). */
export function consentFileName(participantName: string, date: Date) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `consent_${safeFileStem(participantName)}_${stamp}.pdf`;
}

export function isConsentValidFor(consent: Pick<SignedConsent, 'participantName'> | null, participantName: string) {
  const name = participantName.trim();
  return Boolean(consent && name && consent.participantName === name);
}

type JsPdfConstructor = new (options?: { unit?: 'pt'; format?: 'letter'; orientation?: 'portrait' }) => JsPdfDocument;

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ width: 3, height: 1 });
      return;
    }
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 3, height: image.naturalHeight || 1 });
    image.onerror = () => resolve({ width: 3, height: 1 });
    image.src = dataUrl;
  });
}

/** Builds the filled ISEF Human Informed Consent Form and returns the PDF as base64 (no data: prefix). */
export async function buildConsentPdf(record: ConsentRecord, JsPdf: JsPdfConstructor): Promise<string> {
  const doc = new JsPdf({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 46;
  const contentWidth = pageWidth - margin * 2;
  const signedAt = new Date(record.signedAtIso);
  const dateLabel = consentDateLabel(signedAt);
  let y = margin;

  const ensureRoom = (needed: number) => {
    if (y + needed <= pageHeight - margin - 14) return;
    doc.addPage();
    y = margin;
  };
  const paragraph = (text: string, size = 10, style: 'normal' | 'bold' | 'italic' = 'normal', gap = 8) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    const lineHeight = size * 1.3;
    ensureRoom(lines.length * lineHeight);
    doc.text(lines, margin, y + size);
    y += lines.length * lineHeight + gap;
  };
  const field = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const labelText = `${label}: `;
    const labelWidth = doc.getTextWidth(labelText);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(value || '________________________', contentWidth - labelWidth) as string[];
    ensureRoom(lines.length * 13 + 6);
    doc.setFont('helvetica', 'bold');
    doc.text(labelText, margin, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, margin + labelWidth, y + 10);
    y += lines.length * 13 + 6;
  };
  const signatureBlock = async (
    heading: string,
    nameLabel: string,
    printedName: string,
    signature: string | null,
    signedDate: string,
  ) => {
    ensureRoom(112);
    doc.setDrawColor(160);
    doc.setLineWidth(0.6);
    doc.rect(margin, y, contentWidth, 100);
    const top = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(heading, margin + 10, top + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Date Reviewed & Signed (mm/dd/yy): ${signedDate || '____________'}`, margin + 10, top + 32);
    doc.text(`${nameLabel}: ${printedName || '______________________'}`, margin + 10, top + 46);
    doc.text('Signature:', margin + 10, top + 66);
    const boxX = margin + 70;
    const boxWidth = contentWidth - 84;
    doc.line(boxX, top + 90, boxX + boxWidth, top + 90);
    if (signature) {
      const size = await imageSize(signature);
      const maxHeight = 40;
      const maxWidth = boxWidth;
      const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
      doc.addImage(signature, 'PNG', boxX, top + 88 - size.height * scale, size.width * scale, size.height * scale);
    }
    y = top + 100 + 10;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Human Informed Consent Form', pageWidth / 2, y + 14, { align: 'center' });
  y += 30;

  field('Student Researcher(s)', record.settings.studentResearchers);
  field('Title of Project', record.settings.projectTitle);
  y += 4;
  paragraph(INTRO_TEXT, 10, 'italic', 10);
  for (const section of CONSENT_SECTIONS) field(section.label, section.text);
  field(
    'If you have any questions about this study, feel free to contact',
    `Adult Sponsor/QS/DS: ${record.settings.sponsorName || '__________'}   Phone/email: ${record.settings.sponsorContact || '__________'}`,
  );
  y += 4;
  paragraph(`Voluntary Participation: ${VOLUNTARY_TEXT}`, 10, 'normal', 8);
  paragraph(ATTESTATION_TEXT, 10, 'bold', 12);

  const participantSigned = record.signerRole === 'participant';
  await signatureBlock(
    'Adult Informed Consent or Minor Assent',
    'Research Participant Printed Name',
    record.participantName,
    participantSigned ? record.signatureDataUrl : record.assentSignatureDataUrl,
    participantSigned || record.assentSignatureDataUrl ? dateLabel : '',
  );
  await signatureBlock(
    'Parental/Guardian Permission (if applicable)',
    'Parent/Guardian Printed Name',
    participantSigned ? 'N/A — participant is 18 or older' : record.signerName,
    participantSigned ? null : record.signatureDataUrl,
    participantSigned ? '' : dateLabel,
  );

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(
      `Based on the ISEF Human Informed Consent Form (International Rules: Guidelines for Science and Engineering Fairs 2026–2027, societyforscience.org/ISEF). Signed electronically ${signedAt.toLocaleString()} · ID ${record.id} · page ${page}/${pages}`,
      pageWidth / 2,
      pageHeight - 28,
      { align: 'center', maxWidth: contentWidth },
    );
    doc.setTextColor(0);
  }

  const dataUri = doc.output('datauristring');
  return dataUri.slice(dataUri.indexOf(',') + 1);
}

export function buildConsentUploadPayload(consent: SignedConsent) {
  return {
    type: 'consent_pdf' as const,
    consent_id: consent.id,
    filename: consent.fileName,
    participant_name: consent.participantName,
    signer_name: consent.signerName,
    signer_role: consent.signerRole,
    signed_at: consent.signedAtIso,
    pdf_base64: consent.pdfBase64,
  };
}

/** Only the updated Apps Script returns a Drive fileId; the old script silently appends a Results row instead. */
export type ConsentUploadResult = { ok: true; fileId: string; url?: string } | { ok: false; error: string; scriptOutdated?: boolean };

export function parseConsentUploadResponse(body: unknown): ConsentUploadResult {
  if (body && typeof body === 'object') {
    const value = body as { ok?: unknown; fileId?: unknown; url?: unknown; error?: unknown };
    if (value.ok === true && typeof value.fileId === 'string' && value.fileId) {
      return { ok: true, fileId: value.fileId, url: typeof value.url === 'string' ? value.url : undefined };
    }
    if (value.ok === true) {
      return { ok: false, error: 'the upload script needs the consent update — redeploy Code.gs', scriptOutdated: true };
    }
    if (typeof value.error === 'string') return { ok: false, error: value.error };
  }
  return { ok: false, error: 'unexpected response from the upload script' };
}

export function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

const SETTINGS_KEY = 'pushup-consent-settings';
const CURRENT_KEY = 'pushup-consent-current';
const PENDING_KEY = 'pushup-consent-pending';
const PENDING_LIMIT = 15;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadConsentSettings = (): ConsentSettings => ({ ...DEFAULT_CONSENT_SETTINGS, ...readJson<Partial<ConsentSettings>>(SETTINGS_KEY, {}) });
export const saveConsentSettings = (settings: ConsentSettings) => writeJson(SETTINGS_KEY, settings);
export const loadCurrentConsent = () => readJson<SignedConsent | null>(CURRENT_KEY, null);
export const saveCurrentConsent = (consent: SignedConsent | null) => writeJson(CURRENT_KEY, consent);
export const loadPendingConsents = () => readJson<SignedConsent[]>(PENDING_KEY, []);

export function savePendingConsents(pending: SignedConsent[]) {
  let trimmed = pending.slice(-PENDING_LIMIT);
  while (trimmed.length && !writeJson(PENDING_KEY, trimmed)) trimmed = trimmed.slice(1);
  if (!trimmed.length) writeJson(PENDING_KEY, null);
  return trimmed;
}
