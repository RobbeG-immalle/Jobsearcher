import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { EmailOptions } from '../types';

/** Allowed directory for CV attachments – prevents path traversal. */
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

/**
 * Creates a reusable nodemailer transporter from environment variables.
 */
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send a job application email.
 *
 * If `coverLetter` is not supplied, a default one is generated using the
 * applicant's name, the job title, and the company name.
 */
export async function sendApplicationEmail(opts: EmailOptions): Promise<void> {
  const transporter = createTransporter();

  const coverLetter = opts.coverLetter ?? generateDefaultCoverLetter(opts);

  const mailOptions: nodemailer.SendMailOptions = {
    from: process.env.EMAIL_FROM ?? opts.applicantEmail,
    to: opts.to,
    subject: `Application for ${opts.jobTitle} at ${opts.company}`,
    text: coverLetter,
    html: `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${coverLetter}</pre>`,
  };

  // Optionally attach the CV – path must reside within the uploads directory
  if (opts.cvPath) {
    const resolved = path.resolve(opts.cvPath);
    if (
      (resolved === UPLOAD_DIR || resolved.startsWith(UPLOAD_DIR + path.sep)) &&
      fs.existsSync(resolved)
    ) {
      mailOptions.attachments = [
        {
          filename: 'CV.pdf',
          path: resolved,
        },
      ];
    }
  }

  await transporter.sendMail(mailOptions);
  console.log(`[Mailer] Application sent for "${opts.jobTitle}" at ${opts.company}`);
}

/**
 * Generate a simple, professional default cover letter.
 */
function generateDefaultCoverLetter(opts: EmailOptions): string {
  return `Dear Hiring Manager,

I am writing to express my interest in the position of ${opts.jobTitle} at ${opts.company}.

Having come across this opportunity (${opts.jobUrl}), I believe my background and skills make me a strong candidate for this role.

I would welcome the opportunity to discuss how my experience aligns with your requirements.

Please find my CV attached for your consideration.

Kind regards,
${opts.applicantName}
${opts.applicantEmail}
`;
}
