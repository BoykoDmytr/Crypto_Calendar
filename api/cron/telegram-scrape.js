import { run } from "../../scripts/telegram-sync.js";
import { isAuthorizedCron, rejectCron } from "../../scripts/lib/cronAuth.js";

export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    await run();
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
