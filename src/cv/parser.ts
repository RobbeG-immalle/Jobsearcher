import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

/**
 * Parse a CV from a file path (PDF or plain text).
 * Returns the raw extracted text.
 */
export async function parseCVFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return parsePDF(filePath);
  }

  // Treat everything else as plain text (txt, md, etc.)
  return fs.promises.readFile(filePath, 'utf-8');
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

async function parsePDF(filePath: string): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}
