/* eslint-env node */
/* global process */

import { run } from "../../scripts/telegram-broadcast.js";
import { isAuthorizedCron, rejectCron } from "../../scripts/lib/cronAuth.js";

// Requires a valid CRON_SECRET (Vercel Cron sends it automatically). Even though
// the work is idempotent (dedup via tg_posted_at), leaving it open lets anyone
// force Telegram API traffic and hit rate limits.
export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    const summary = await run();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}