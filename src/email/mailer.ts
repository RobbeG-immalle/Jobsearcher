import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { EmailOptions } from '../types';

/** Directory where CV attachments are stored (basename-validated by callers). */
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
 *
 * `cvPath` (if supplied) MUST be a path pre-constructed by callers using
 * `path.join(UPLOAD_DIR, path.basename(userInput))` to prevent traversal.
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

  // Attach CV only if the path is within the uploads directory and exists
  if (opts.cvPath) {
    const cvPathResolved = path.resolve(opts.cvPath);
    const inUploadDir =
      cvPathResolved === UPLOAD_DIR || cvPathResolved.startsWith(UPLOAD_DIR + path.sep);
    if (inUploadDir && fs.existsSync(cvPathResolved)) {
      mailOptions.attachments = [
        {
          filename: 'CV.pdf',
          path: cvPathResolved,
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
