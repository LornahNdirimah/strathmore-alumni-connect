/**
 * Outgoing email (DESIGN_BACKLOG #43).
 *
 * Three transports, chosen by MAIL_TRANSPORT:
 *   - smtp     any SMTP server. In development that is Mailpit (npm run mail),
 *              a local test inbox at http://localhost:8025 — nothing leaves
 *              the machine. In production, a real relay set by env vars.
 *   - console  prints each message to the API log.
 *   - memory   keeps messages in an array; the test suites read it.
 *
 * Sending never blocks or fails the request that caused it. Messages are sent
 * after the caller's database work has committed, and a delivery failure is
 * logged, not thrown: an unreachable mail server must not stop someone
 * signing up. Every flow that emails has a way to ask again (resend
 * verification, request another reset link).
 */
import nodemailer, { type Transporter } from 'nodemailer'

import { env, isProduction } from '../config/env.js'

export type OutgoingEmail = {
  to: string
  subject: string
  text: string
  html: string
}

/** Messages captured by the 'memory' transport, newest last. */
export const sentEmails: OutgoingEmail[] = []

let transporter: Transporter | null = null
function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
    // Keep a slow or absent server from holding a request's work open.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  })
  return transporter
}

type Logger = { info: (msg: string) => void; warn: (msg: string) => void }
let logger: Logger = { info: (msg) => console.log(msg), warn: (msg) => console.warn(msg) }

/** Lets the app route mail logs through Fastify's logger. */
export function setMailLogger(next: Logger): void {
  logger = next
}

/** The frontend's public address, for links inside emails. */
export function appUrl(path: string): string {
  const base = env.APP_URL ?? env.CORS_ORIGIN
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}

async function deliver(message: OutgoingEmail): Promise<void> {
  switch (env.MAIL_TRANSPORT) {
    case 'memory':
      sentEmails.push(message)
      return
    case 'console':
      logger.info(`[mail] to ${message.to}: ${message.subject}\n${message.text}`)
      return
    case 'smtp':
      await smtp().sendMail({ from: env.MAIL_FROM, ...message })
  }
}

/**
 * Queues `message` to go out once the current work has finished. Returns at
 * once; the result is only logged.
 */
export function sendEmail(message: OutgoingEmail): void {
  setImmediate(() => {
    deliver(message).catch((error: Error) => {
      logger.warn(
        `[mail] could not send "${message.subject}" to ${message.to}: ${error.message}` +
          (isProduction ? '' : ' — is Mailpit running? Start it with `npm run mail`, or set MAIL_TRANSPORT=console.'),
      )
    })
  })
}

// --- Templates --------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** One plain layout: a short message and a single button. */
function layout(greeting: string, body: string, action: { label: string; url: string }, footer: string) {
  const text = `${greeting}\n\n${body}\n\n${action.label}: ${action.url}\n\n${footer}\n\n— Strathmore Alumni Connect`
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f1a14;max-width:32rem;margin:0 auto;padding:1.5rem">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:.7rem 1.2rem;background:#0b6b3a;color:#fff;border-radius:.6rem;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="color:#5a7263;font-size:.85rem">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>
<p style="color:#5a7263;font-size:.85rem">${escapeHtml(footer)}</p>
<p style="color:#5a7263;font-size:.85rem">— Strathmore Alumni Connect</p>
</body></html>`
  return { text, html }
}

export function verificationEmail(to: string, name: string, link: string): OutgoingEmail {
  return {
    to,
    subject: 'Confirm your email for Strathmore Alumni Connect',
    ...layout(
      `Hi ${name},`,
      'Please confirm this is your email address so we can reach you about mentorship requests, sessions and account security.',
      { label: 'Confirm my email', url: link },
      'This link works for 24 hours. If you did not create an account, you can ignore this email.',
    ),
  }
}

export function passwordResetEmail(to: string, name: string, link: string): OutgoingEmail {
  return {
    to,
    subject: 'Reset your Strathmore Alumni Connect password',
    ...layout(
      `Hi ${name},`,
      'Someone asked to reset the password for this account. If it was you, choose a new password here.',
      { label: 'Choose a new password', url: link },
      'This link works for one hour and only once. If you did not ask for it, you can ignore this email — your password has not changed.',
    ),
  }
}

export function invitationEmail(to: string, name: string, link: string): OutgoingEmail {
  return {
    to,
    subject: 'You are invited to Strathmore Alumni Connect',
    ...layout(
      `Hi ${name},`,
      'The Strathmore alumni office has added you to Strathmore Alumni Connect, where alumni mentor students and stay in touch with each other. Your account is ready — choose a password to sign in.',
      { label: 'Set my password', url: link },
      'This link works for 7 days. If you were not expecting this, you can ignore it.',
    ),
  }
}
