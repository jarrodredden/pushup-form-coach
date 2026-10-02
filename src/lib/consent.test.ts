import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import {
  buildConsentPdf,
  buildConsentUploadPayload,
  consentDateLabel,
  consentFileName,
  DEFAULT_CONSENT_SETTINGS,
  isConsentValidFor,
  parseConsentUploadResponse,
  safeFileStem,
  type SignedConsent,
} from './consent';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('consent file naming', () => {
  it('makes a filesystem-safe stem from the display name', () => {
    expect(safeFileStem('Connor Smith')).toBe('Connor-Smith');
    expect(safeFileStem('  Zoë / O’Brien!! ')).toBe('Zoe-O-Brien');
    expect(safeFileStem('../../etc/passwd')).toBe('etc-passwd');
    expect(safeFileStem('???')).toBe('participant');
    expect(safeFileStem('a'.repeat(80))).toHaveLength(40);
  });

  it('adds a sortable local timestamp', () => {
    const date = new Date(2026, 9, 1, 14, 5, 9);
    expect(consentFileName('Connor Smith', date)).toBe('consent_Connor-Smith_2026-10-01_14-05-09.pdf');
    expect(consentDateLabel(date)).toBe('10/01/26');
  });
});

describe('consent gate', () => {
  it('only counts a consent signed for the current participant name', () => {
    const consent = { participantName: 'Connor' };
    expect(isConsentValidFor(consent, 'Connor')).toBe(true);
    expect(isConsentValidFor(consent, ' Connor ')).toBe(true);
    expect(isConsentValidFor(consent, 'Enzo')).toBe(false);
    expect(isConsentValidFor(consent, '')).toBe(false);
    expect(isConsentValidFor(null, 'Connor')).toBe(false);
  });
});

describe('consent Drive upload', () => {
  const signed: SignedConsent = {
    id: 'abc',
    participantName: 'Connor',
    signerRole: 'guardian',
    signerName: 'Pat Parent',
    signedAtIso: '2026-10-01T18:05:09.000Z',
    fileName: 'consent_Connor_2026-10-01_14-05-09.pdf',
    pdfBase64: 'JVBERi0=',
    uploaded: false,
  };

  it('posts a consent_pdf payload the Apps Script can route', () => {
    expect(buildConsentUploadPayload(signed)).toMatchObject({
      type: 'consent_pdf',
      filename: signed.fileName,
      pdf_base64: 'JVBERi0=',
      participant_name: 'Connor',
      signer_name: 'Pat Parent',
      signer_role: 'guardian',
    });
  });

  it('treats a plain ok without a Drive file id as the old, un-updated script', () => {
    expect(parseConsentUploadResponse({ ok: true, fileId: 'f1', url: 'https://drive' })).toEqual({ ok: true, fileId: 'f1', url: 'https://drive' });
    const legacy = parseConsentUploadResponse({ ok: true });
    expect(legacy.ok).toBe(false);
    expect(!legacy.ok && legacy.error).toMatch(/redeploy/i);
    expect(!legacy.ok && legacy.scriptOutdated).toBe(true);
    expect(parseConsentUploadResponse({ ok: false, error: 'Exception: no Drive access' })).toEqual({ ok: false, error: 'Exception: no Drive access' });
    expect(parseConsentUploadResponse(null).ok).toBe(false);
  });
});

describe('consent PDF', () => {
  it('builds a filled ISEF consent PDF with the signer and date', async () => {
    const base64 = await buildConsentPdf(
      {
        id: 'abc',
        participantName: 'Connor',
        signerRole: 'guardian',
        signerName: 'Pat Parent',
        signedAtIso: new Date(2026, 9, 1, 14, 5, 9).toISOString(),
        signatureDataUrl: ONE_PIXEL_PNG,
        assentSignatureDataUrl: null,
        settings: { ...DEFAULT_CONSENT_SETTINGS, studentResearchers: 'Connor and Enzo' },
      },
      jsPDF,
    );
    const text = Buffer.from(base64, 'base64').toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('Human Informed Consent Form');
    expect(text).toContain('Pat Parent');
    expect(text).toContain('10/01/26');
    expect(text).toContain('/Subtype /Image');
  });
});
