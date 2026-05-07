/* eslint-env node */
/* global process */

import { run } from "../../scripts/telegram-broadcast.js";

export default async function handler(req, res) {
  try {
    const authHeader = req.headers?.authorization || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");

    // 1) Vercel Cron auto-injects `Authorization: Bearer <CRON_SECRET>`
    //    where CRON_SECRET is a system env var auto-generated when crons
    //    are defined in vercel.json. Accept that and let cron through.
    const isVercelCron =
      process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;

    // 2) Manual / curl invocations can pass our own secret via ?secret=...
    //    or `Authorization: Bearer <TELEGRAM_BROADCAST_SECRET>`.
    const manualSecret = process.env.TELEGRAM_BROADCAST_SECRET;
    const provided = req?.query?.secret || bearer;
    const isManualOk = manualSecret && provided === manualSecret;

    // Only enforce auth if at least one secret is configured. If neither is
    // set (e.g. local dev), allow through.
    const authConfigured = !!(process.env.CRON_SECRET || manualSecret);
    if (authConfigured && !isVercelCron && !isManualOk) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const summary = await run();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}