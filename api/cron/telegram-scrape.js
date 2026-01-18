import { run } from "../../scripts/telegram-sync.js";

export default async function handler(req, res) {
  try {
    await run();
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
