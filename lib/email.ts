import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  salonName?: string;
}

export async function sendEmail({ to, subject, html, salonName }: SendEmailOptions) {
  const fromName = salonName || "AestheTech";
  const from = `${fromName} <${FROM_EMAIL}>`;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Email send error:", error);
    throw new Error(error.message || "Failed to send email");
  }

  return data;
}
