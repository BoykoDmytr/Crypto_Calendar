/* eslint-env node */
/* global process */

// Shared auth gate for cron / privileged maintenance endpoints.
//
// Vercel Cron automatically attaches `Authorization: Bearer <CRON_SECRET>` to
// scheduled invocations when the CRON_SECRET env var is set on the project, so
// the SAME check both protects the endpoint from anonymous callers and lets the
// scheduler through.
//
// Fails CLOSED: if no secret is configured the request is rejected. There is no
// "allow when unset" fallback — that would defeat the purpose (an unset env var
// must never expose a privileged endpoint to the public internet).

function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  // Length leak is acceptable here; the values are high-entropy secrets.
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) {
    diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * @param req            Vercel/Node request (uses req.headers + req.query).
 * @param extraSecrets   Additional accepted secrets (e.g. a legacy per-endpoint
 *                       secret) — falsy entries are ignored.
 * @returns {boolean}    true when the caller presented a valid secret.
 */
export function isAuthorizedCron(req, { extraSecrets = [] } = {}) {
  const accepted = [process.env.CRON_SECRET, ...extraSecrets].filter(Boolean);
  if (!accepted.length) return false; // fail closed — nothing configured

  const header =
    (req.headers && (req.headers.authorization || req.headers.Authorization)) ||
    "";
  const bearer = String(header).replace(/^Bearer\s+/i, "").trim();

  // Also accept ?secret= / ?token= for manual curl and legacy callers.
  const query =
    (req.query && (req.query.secret || req.query.token)) || "";

  const provided = bearer || String(query).trim();
  if (!provided) return false;

  return accepted.some((s) => safeEqual(provided, s));
}

export function rejectCron(res) {
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}
