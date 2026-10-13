// lib/portal/notify.js - portal email notifications via Resend.
// Every send is best-effort: a mail failure must never fail the user action.
//
// Env vars: RESEND_API_KEY (already set for magic links),
//           PORTAL_NOTIFY_EMAIL (internal inbox for new-submission alerts;
//           falls back to PORTAL_ADMIN_EMAILS / ADMIN_EMAILS first entry),
//           PORTAL_NOTIFY_FROM (defaults to no-reply style sender).

import { Resend } from 'resend';

function internalRecipient() {
  if (process.env.PORTAL_NOTIFY_EMAIL) return process.env.PORTAL_NOTIFY_EMAIL;
  const raw = process.env.PORTAL_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '';
  return raw.split(',').map((e) => e.trim()).filter(Boolean)[0] || null;
}

async function send({ to, subject, html }) {
  try {
    if (!process.env.RESEND_API_KEY || !to) return;
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.PORTAL_NOTIFY_FROM || 'PEOLens <notifications@peolens.com>',
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[portal notify] send failed:', err.message);
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://peolens.com';

export async function notifySubmissionReceived({ submission }) {
  // Internal alert
  await send({
    to: internalRecipient(),
    subject: `New portal submission: ${submission.CompanyName || 'Untitled'}`,
    html: `<p>A new company was submitted for PEO review.</p>
<p><strong>${submission.CompanyName || 'Untitled'}</strong> — ${submission.EmployeeCount || '?'} employees, ${submission.States || 'states n/a'}.</p>
<p>Risk screen: <strong>${submission.RiskLevel || 'n/a'}</strong></p>
<p><a href="${APP_URL}/portal/admin">Open the review dashboard</a></p>`,
  });
  // Submitter confirmation
  await send({
    to: submission.SubmitterEmail,
    subject: `We received your submission: ${submission.CompanyName || 'your company'}`,
    html: `<p>Thanks — your submission for <strong>${submission.CompanyName || 'your company'}</strong> was received and is in review.</p>
<p>You can track status or add documents any time at <a href="${APP_URL}/portal">${APP_URL.replace('https://', '')}/portal</a>.</p>`,
  });
}

export async function notifyStatusChanged({ submission, newStatus, note }) {
  await send({
    to: submission.SubmitterEmail,
    subject: `Update on ${submission.CompanyName || 'your submission'}: ${newStatus}`,
    html: `<p>The status of <strong>${submission.CompanyName || 'your submission'}</strong> changed to <strong>${newStatus}</strong>.</p>
${note ? `<p>${note}</p>` : ''}
<p><a href="${APP_URL}/portal">View your submissions</a></p>`,
  });
}
