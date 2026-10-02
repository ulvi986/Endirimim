import { env } from '../config/env.js'

export type MailMessage = { to: string; subject: string; text: string; html?: string }

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/**
 * Fallback when no transport is configured. Deliberately loud in production:
 * password reset messages do not reach users without one.
 */
class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    if (env.isProduction) {
      console.error(
        '[mail] DROPPED: no mail transport configured in production. ' +
          `Set RESEND_API_KEY and MAIL_FROM. Intended recipient: ${message.to} — ${message.subject}`,
      )
      return
    }

    console.log(
      ['', '─────────────── EMAIL (dev console transport) ───────────────', `To:      ${message.to}`, `Subject: ${message.subject}`, '', message.text, '──────────────────────────────────────────────────────────────', ''].join('\n'),
    )
  }
}

/** Resend's HTTP API — no SDK, and it works from serverless functions. */
class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    // A failed send must not reveal accounts: the user can request another reset.
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        console.error(`[mail] Resend rejected the message (${response.status}): ${await response.text().catch(() => '')}`)
      }
    } catch (error) {
      console.error('[mail] Resend request failed', error)
    }
  }
}

export const mailer: Mailer =
  env.RESEND_API_KEY && env.MAIL_FROM ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : new ConsoleMailer()

export const passwordResetPath = (token: string) => `/reset-password?token=${encodeURIComponent(token)}`

/**
 * There is no mail transport yet, so outside production the API also returns the
 * link itself (as a path on the web app). This keeps
 * password reset usable locally; production never exposes it.
 */
export const devLink = (path: string): string | undefined => (env.isProduction ? undefined : path)

export function passwordResetEmail(token: string): { subject: string; text: string } {
  const link = `${env.APP_URL}${passwordResetPath(token)}`
  return {
    subject: 'Endirimim şifrə sıfırlama',
    text: `Şifrənizi yeniləmək üçün bu keçidə klikləyin:\n${link}\n\nKeçid ${Math.round(env.PASSWORD_RESET_TTL_SECONDS / 60)} dəqiqə ərzində etibarlıdır. Bu sorğunu siz göndərməmisinizsə, emaili nəzərə almayın.`,
  }
}
