import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

/**
 * Parse a CV from a file path (PDF or plain text).
 * The path MUST be pre-validated (inside the uploads directory) by the caller.
 * Returns the raw extracted text.
 */
export async function parseCVFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.promises.readFile(filePath);

  if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  // Treat everything else as plain text (txt, md, etc.)
  return buffer.toString('utf-8');
}

/**
 * Parse a CV from a Buffer (e.g. uploaded via multipart form).
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
