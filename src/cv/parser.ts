import pdfParse from 'pdf-parse';

/**
 * Parse a CV from a Buffer (e.g. uploaded via multipart form or read from disk).
 * mimeType should be 'application/pdf' or 'text/plain'.
 */
export async function parseCVBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  return buffer.toString('utf-8');
}
