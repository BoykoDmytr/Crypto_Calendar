-- Tracking table for messages the admin bot posts to the moderator chat.
-- Each row is a notification the bot sent for a single pending event;
-- callback handlers look up the row to resolve short_id -> full uuid and
-- to enforce single-resolution idempotency.
--
-- No FK to pending tables: rows there get deleted on approve, and we want
-- the audit trail to outlive them.

CREATE TABLE IF NOT EXISTS public.telegram_admin_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_id           uuid NOT NULL,
  source               text NOT NULL CHECK (source IN ('pending', 'auto_pending')),
  tg_chat_id           bigint NOT NULL,
  tg_message_id        bigint NOT NULL,
  status               text NOT NULL DEFAULT 'awaiting'
                       CHECK (status IN ('awaiting', 'approved', 'rejected', 'stale')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  resolved_by_tg_id    bigint,
  resolved_by_username text,
  UNIQUE (pending_id, source)
);

CREATE INDEX IF NOT EXISTS idx_telegram_admin_messages_awaiting
  ON public.telegram_admin_messages (created_at)
  WHERE status = 'awaiting';

-- Lookup index used by the webhook callback handler.
CREATE INDEX IF NOT EXISTS idx_telegram_admin_messages_chat_msg
  ON public.telegram_admin_messages (tg_chat_id, tg_message_id);
