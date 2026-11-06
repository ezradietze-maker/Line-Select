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
  return (await sendEmailExplained(message)).sent;
}

/** Which of the settings email needs are missing — names only, never values. */
export function missingEmailSettings(): string[] {
  return (["RESEND_API_KEY", "EMAIL_FROM", "APP_URL"] as const).filter((name) => !process.env[name]?.trim());
}

/**
 * Sends and says why not when it didn't: settings missing, or Resend's own answer (a 403 when the test sender
 * `onboarding@resend.dev` is asked to mail anyone but the Resend account's owner). A refusal is logged with that
 * answer, so a missing email can be traced in the server logs instead of guessed at.
 */
export async function sendEmailExplained(message: { to: string; subject: string; text: string }): Promise<{ sent: boolean; reason?: string }> {
  const config = getEmailConfig();
  if (!config) return { sent: false, reason: `email isn't set up: missing ${missingEmailSettings().join(", ")}` };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (res.ok) return { sent: true };
    const reason = `Resend answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
    console.error("[email] not sent", { subject: message.subject, reason });
    return { sent: false, reason };
  } catch (e) {
    const reason = `couldn't reach Resend: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[email] not sent", { subject: message.subject, reason });
    return { sent: false, reason };
  }
}
