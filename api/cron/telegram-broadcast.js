/* eslint-env node */
/* global process */

import { run } from "../../scripts/telegram-broadcast.js";

export default async function handler(req, res) {
  try {
    // Optional shared-secret guard (same pattern as delete-old-events).
    const envSecret = process.env.TELEGRAM_BROADCAST_SECRET;
    const providedSecret =
      req?.query?.secret ||
      req.headers?.authorization?.replace(/^Bearer /, "");

    if (envSecret && providedSecret !== envSecret) {
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