/**
 * Transactional email through Resend's HTTP API (no SDK — one POST).
 *
 * Off by default: it only turns on when all three env vars are set, so
 * nothing here can send mail (or crash) on a deployment that hasn't chosen
 * an email provider. `APP_URL` is required rather than derived from the
 * request because a reset link built from the incoming Host header could be
 * pointed at an attacker's domain by a forged request.
 */
export interface EmailConfig {
  apiKey: string;
  from: string;
  appUrl: string;
}

export function getEmailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return apiKey && from && appUrl ? { apiKey, from, appUrl } : null;
}

export function isEmailConfigured(): boolean {
  return getEmailConfig() !== null;
}

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<boolean> {
  const config = getEmailConfig();
  if (!config) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
