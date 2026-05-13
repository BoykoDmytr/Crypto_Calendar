/* eslint-env node */
/* global process */

// One-shot: register the admin bot webhook + slash command list.
// Run after deploying to Vercel and after setting the env vars below.
//
// Required env:
//   TELEGRAM_ADMIN_BOT_TOKEN
//   TELEGRAM_ADMIN_WEBHOOK_URL    e.g. https://cryptoeventscalendar.com/api/telegram/webhook
//   TELEGRAM_ADMIN_WEBHOOK_SECRET random 32-char string

const TG_TIMEOUT_MS = 10_000;

async function tg(token, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(
        `Telegram ${method} failed: ${res.status} ${json.description || ""}`,
      );
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const token = process.env.TELEGRAM_ADMIN_BOT_TOKEN;
  const url = process.env.TELEGRAM_ADMIN_WEBHOOK_URL;
  const secret = process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET;

  if (!token) throw new Error("Missing TELEGRAM_ADMIN_BOT_TOKEN");
  if (!url) throw new Error("Missing TELEGRAM_ADMIN_WEBHOOK_URL");
  if (!secret) throw new Error("Missing TELEGRAM_ADMIN_WEBHOOK_SECRET");

  const setResult = await tg(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  console.log("setWebhook:", setResult);

  const cmds = await tg(token, "setMyCommands", {
    commands: [
      { command: "pending", description: "Show pending events" },
      { command: "stats", description: "Show today's stats" },
      { command: "today", description: "List events broadcast today" },
      { command: "help", description: "Show available commands" },
    ],
  });
  console.log("setMyCommands:", cmds);

  const info = await tg(token, "getWebhookInfo", {});
  console.log("getWebhookInfo:", info);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
