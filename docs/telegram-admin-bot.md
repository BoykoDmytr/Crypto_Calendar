# Telegram admin bot

Separate Telegram bot that lets a whitelist of admins moderate pending events
from Telegram. Receives updates via webhook (no long-polling, no daemon).

## Architecture

- **Webhook**: `api/telegram/webhook.js` — single endpoint Telegram posts to.
  Auth via `X-Telegram-Bot-Api-Secret-Token` header. Always responds 200
  (Telegram retries non-2xx for 24h, so we swallow errors after acking).
- **Authorization**: every callback/message must come from a Telegram user
  whose numeric id is listed in `ADMIN_TG_USER_IDS` (comma-separated).
  Non-admin callbacks get a silent "Not authorized" toast. Non-admin DMs are
  ignored.
- **Notify cron**: `api/cron/telegram-notify-pending.js` runs every 5 min,
  posts new `events_pending` / `auto_events_pending` rows to
  `ADMIN_TG_CHAT_ID` with Approve / Reject / Edit-on-site buttons.
- **Dedup**: `telegram_admin_messages` table tracks each notification by
  `(pending_id, source)` UNIQUE — re-running the cron will not double-post.
- **Approval logic**: shared module `scripts/lib/approveEvent.js`, used by
  both the web admin and the bot. Identical enrichment (dropstab-circ,
  mcap_usd, event_usd_value, coin_pct_circ).

## Environment variables

```
TELEGRAM_ADMIN_BOT_TOKEN=         # separate bot from the public broadcast one
TELEGRAM_ADMIN_WEBHOOK_SECRET=    # random 32-char string, generate yourself
TELEGRAM_ADMIN_WEBHOOK_URL=https://cryptoeventscalendar.com/api/telegram/webhook
ADMIN_TG_USER_IDS=12345678,87654321   # comma-separated TG numeric user IDs
ADMIN_TG_CHAT_ID=-1001234567890        # private group/channel for notifications
SITE_URL=https://cryptoeventscalendar.com

# Optional — only needed if you want commands to work in group chats with
# the `/cmd@botname` form. DM-only setups can skip this.
TELEGRAM_ADMIN_BOT_USERNAME=my_admin_bot
```

Existing vars reused: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Setup

1. Talk to [@BotFather](https://t.me/BotFather): `/newbot`, pick a name. Save
   the token as `TELEGRAM_ADMIN_BOT_TOKEN`. Use a fresh bot — do not reuse the
   public broadcast bot.
2. Create a private group or channel for admins. Add the bot as admin so it
   can post and edit messages. Grab the chat id (e.g. with `@RawDataBot`).
   Save it as `ADMIN_TG_CHAT_ID` (negative for groups/channels).
3. Send `/start` to the bot in a DM from each admin account. Get their
   numeric user id (also via `@RawDataBot`). Comma-separate into
   `ADMIN_TG_USER_IDS`.
4. Generate a random 32-char string for `TELEGRAM_ADMIN_WEBHOOK_SECRET`
   (e.g. `openssl rand -hex 16`).
5. Set all env vars in Vercel (Project → Settings → Environment Variables)
   AND mirror them locally in `.env` if you want to run the setup script.
6. Deploy the branch to Vercel.
7. Apply the migrations: `supabase db push` (or via the dashboard).
8. Run the webhook setup script locally:
   `npm run tg:setup-admin-webhook`
   This calls `setWebhook` and `setMyCommands`.
9. Insert a test row into `events_pending` and wait ≤5 min — the bot should
   post it to the admin chat with the action buttons.

## Adding a new admin

1. Have them DM the bot at least once (so Telegram has the user id).
2. Run `@RawDataBot` or any "what is my user id" bot from their account.
3. Append the numeric id to `ADMIN_TG_USER_IDS` in Vercel env vars.
4. Redeploy (or wait for the next deploy) — the env var is read on every
   request, but Vercel only picks up new values on deploy.

## Troubleshooting

- **401 from webhook**: secret mismatch. Verify `TELEGRAM_ADMIN_WEBHOOK_SECRET`
  in Vercel matches what `setWebhook` was called with. Re-run the setup
  script to push the current value.
- **Webhook silently does nothing**: check Vercel function logs filtered by
  `[telegram-admin]`. The handler always returns 200 to Telegram, even on
  error, to avoid retry storms. Errors surface only in logs.
- **"callback_data is too long"**: TG limits callback_data to 64 bytes. We
  use the form `a:pending:<short_id>` where `short_id` is the first 8 hex
  chars of the row UUID. If you change the format, keep total length ≤ 64
  bytes.
- **"message is too long"**: Telegram caps text at 4096 chars. The cron and
  webhook truncate at 4000. Long descriptions get clipped — that's intended.
- **Duplicate notifications**: the `telegram_admin_messages` UNIQUE
  constraint on `(pending_id, source)` prevents this. If a row exists with
  status `awaiting` but the message was deleted in Telegram, delete the
  tracking row manually to re-notify.
- **"Bot was blocked by the user"**: only happens for DMs. The notify cron
  uses the chat id of the admin group, not individual DMs.

## Files

- `supabase/migrations/20260513120000_telegram_admin_messages.sql` — tracking table.
- `scripts/lib/approveEvent.js` — shared approve/reject + enrichment.
- `scripts/lib/eventFormatting.js` — shared `buildPost(ev, opts)`.
- `scripts/setup-telegram-admin-webhook.js` — one-shot webhook setup.
- `api/telegram/webhook.js` — TG → server.
- `api/cron/telegram-notify-pending.js` — server → TG (notifications).
- `supabase/migrations/20260513120100_events_approved_tg_dirty.sql` —
  `tg_dirty` flag on `events_approved` for in-place broadcast edits.

## Broadcast edits (Stage 3)

When an admin edits an event on the site that was already posted to the
public channel, `Admin.jsx` sets `tg_dirty = true` on that row. The
existing hourly broadcast cron has two phases:

1. **Post**: rows with `tg_posted_at IS NULL` (unchanged from before).
2. **Edit**: rows with `tg_dirty = true AND tg_message_id IS NOT NULL`.
   Calls `editMessageText` and clears the flag.

Special cases handled in phase 2:
- `message is not modified` → clear flag (success, no-op edit).
- `message to edit not found` → if post < 48h old, clear
  `tg_message_id` + `tg_posted_at` so phase 1 re-posts. Older than 48h:
  clear flag only (don't spam the channel with old events).

Each phase caps at 20 ops per run to stay under the 60s function budget.

Deleting an event from `events_approved` does **not** delete the
Telegram post — out of scope, do it manually if needed.
