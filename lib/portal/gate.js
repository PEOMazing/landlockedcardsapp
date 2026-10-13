// lib/portal/gate.js - feature flag + admin gate for the submission portal.
//
// PORTAL_ENABLED=1 turns the portal on (server-checked; pages 404 and API
// routes 404 without it, so shipping the code is safe before launch).
// PORTAL_ADMIN_EMAILS is a comma-separated allowlist of internal reviewer
// emails. Falls back to ADMIN_EMAILS if you prefer a single var.

export function portalEnabled() {
  return process.env.PORTAL_ENABLED === '1';
}

export function isPortalAdmin(session) {
  if (!session?.email) return false;
  const raw = process.env.PORTAL_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '';
  const allow = new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
  return allow.has(session.email.toLowerCase());
}
