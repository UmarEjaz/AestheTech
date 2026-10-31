import "server-only";
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.warn("RESEND_API_KEY is not configured — email sending will fail");
}

const resend = new Resend(apiKey);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  salonName?: string;
  // Optional file attachments (e.g. a receipt/invoice PDF). `content` is the raw file bytes.
  attachments?: Array<{ filename: string; content: Buffer }>;
}

/** Sends one email through Resend and returns the provider's `{ id }` for the queued message. */
export async function sendEmail({ to, subject, html, salonName, attachments }: SendEmailOptions): Promise<{ id: string } | null> {
  const fromName = salonName || "AestheTech";
  const from = `${fromName} <${FROM_EMAIL}>`;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });

  if (error) {
    console.error("Email send error:", error);
    throw new Error(error.message || "Failed to send email");
  }

  return data;
}
