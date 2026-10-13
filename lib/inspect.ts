import { imageSize } from 'image-size';
import { PDFDocument } from 'pdf-lib';
import type { FileFacts } from './accuracy';

/** Read what we need to know about an uploaded file: its type, size, pixels, pages. */
export async function inspectBuffer(buf: Buffer, declaredMime: string, bytes = buf.length): Promise<FileFacts> {
  const sniffed = sniffMime(buf) ?? declaredMime;
  const facts: FileFacts = { mime: sniffed, bytes };
  try {
    if (sniffed === 'image/jpeg' || sniffed === 'image/png') {
      const d = imageSize(buf);
      facts.widthPx = d.width;
      facts.heightPx = d.height;
    } else if (sniffed === 'application/pdf') {
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
      facts.pages = pdf.getPageCount();
      const { width, height } = pdf.getPage(0).getSize();
      facts.pageWidthIn = width / 72;
      facts.pageHeightIn = height / 72;
    }
  } catch {
    // Unreadable files fall through with no dimensions; the check reports it in plain words.
  }
  return facts;
}

/** Trust the file's own first bytes over whatever the browser claimed. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}
