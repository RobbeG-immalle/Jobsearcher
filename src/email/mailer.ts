import nodemailer from 'nodemailer';
import fs from 'fs';
import { EmailOptions } from '../types';

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

  // Optionally attach the CV
  if (opts.cvPath && fs.existsSync(opts.cvPath)) {
    mailOptions.attachments = [
      {
        filename: 'CV.pdf',
        path: opts.cvPath,
      },
    ];
  }

  await transporter.sendMail(mailOptions);
  console.log(`[Mailer] Application sent to ${opts.to} for "${opts.jobTitle}" at ${opts.company}`);
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
