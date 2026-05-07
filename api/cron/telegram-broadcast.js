/* eslint-env node */
/* global process */

import { run } from "../../scripts/telegram-broadcast.js";

// No auth: this endpoint only reads events_approved and posts to a fixed
// Telegram chat. Dedup via tg_posted_at means duplicate calls are no-ops.
// Vercel Cron user-agent is "vercel-cron/1.0" if you ever want to log it.
export default async function handler(_req, res) {
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