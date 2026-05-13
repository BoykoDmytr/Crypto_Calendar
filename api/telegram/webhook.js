/* eslint-env node */
/* global process */

// Admin Telegram bot webhook.
//
// - Always responds 200 quickly. Telegram retries non-2xx for 24h which would
//   duplicate-process every update; all errors are swallowed and logged.
// - Auth: header `X-Telegram-Bot-Api-Secret-Token` must match
//   TELEGRAM_ADMIN_WEBHOOK_SECRET (set when calling setWebhook).
// - Authorization: update.from.id must be in ADMIN_TG_USER_IDS.
//
// Stage 1 wires callback_query (approve/reject buttons). Stage 2 adds command
// handlers (/pending, /stats, /today, /help) in the same file.

import { createClient } from "@supabase/supabase-js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import {
  approvePendingEvent,
  rejectPendingEvent,
} from "../../scripts/lib/approveEvent.js";
import { buildPost, esc } from "../../scripts/lib/eventFormatting.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TG_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAdminIds() {
  return new Set(
    String(process.env.ADMIN_TG_USER_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function isAdmin(userId) {
  if (userId == null) return false;
  return parseAdminIds().has(String(userId));
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function tgApi(method, body) {
  const token = process.env.TELEGRAM_ADMIN_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_ADMIN_BOT_TOKEN");

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
      const err = new Error(
        `Telegram ${method} failed: ${res.status} ${json.description || ""}`,
      );
      err.response = json;
      err.status = res.status;
      throw err;
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

const answerCallback = (id, text, opts = {}) =>
  tgApi("answerCallbackQuery", { callback_query_id: id, text, ...opts });

function formatResolvedHeader(action, username, ts) {
  const who = username ? `@${username}` : "admin";
  const time = dayjs(ts).utc().format("HH:mm");
  const icon = action === "approve" ? "✅" : action === "reject" ? "❌" : "⚠️";
  const verb =
    action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Stale";
  return `${icon} <b>${verb}</b> by ${esc(who)} at ${time} UTC`;
}

// ---------------------------------------------------------------------------
// Callback handler
// ---------------------------------------------------------------------------

async function handleCallback(update) {
  const cb = update.callback_query;
  const fromId = cb?.from?.id;
  const username = cb?.from?.username || cb?.from?.first_name || "";

  if (!isAdmin(fromId)) {
    try {
      await answerCallback(cb.id, "Not authorized");
    } catch (err) {
      console.error("[telegram-admin] answerCallback failed", err?.message);
    }
    return;
  }

  const data = String(cb.data || "");
  // Expected: "a:<source>:<short_id>" or "r:<source>:<short_id>"
  const m = /^([ar]):(pending|auto_pending):([a-f0-9]{4,12})$/i.exec(data);
  if (!m) {
    await answerCallback(cb.id, "Unknown action");
    return;
  }

  const action = m[1] === "a" ? "approve" : "reject";
  const source = m[2];
  const shortId = m[3].toLowerCase();
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (!chatId || !messageId) {
    await answerCallback(cb.id, "Missing chat/message ids");
    return;
  }

  const supabase = getSupabase();

  // Look up the tracking row by (chat_id, message_id) — the source of truth
  // for the full pending UUID.
  const { data: trackRow, error: trackErr } = await supabase
    .from("telegram_admin_messages")
    .select("id, pending_id, source, status, resolved_by_username")
    .eq("tg_chat_id", chatId)
    .eq("tg_message_id", messageId)
    .maybeSingle();

  if (trackErr || !trackRow) {
    await answerCallback(cb.id, "Tracking row missing");
    console.error("[telegram-admin] tracking lookup failed", trackErr?.message);
    return;
  }

  if (trackRow.source !== source) {
    await answerCallback(cb.id, "Source mismatch");
    return;
  }

  // Defense in depth: short_id must prefix the stored UUID.
  if (!String(trackRow.pending_id).toLowerCase().startsWith(shortId)) {
    await answerCallback(cb.id, "ID mismatch");
    return;
  }

  if (trackRow.status !== "awaiting") {
    const by = trackRow.resolved_by_username
      ? `@${trackRow.resolved_by_username}`
      : "someone";
    await answerCallback(cb.id, `Already ${trackRow.status} by ${by}`);
    return;
  }

  // Execute action.
  let result;
  if (action === "approve") {
    result = await approvePendingEvent({
      supabase,
      source,
      id: trackRow.pending_id,
    });
  } else {
    result = await rejectPendingEvent({
      supabase,
      source,
      id: trackRow.pending_id,
    });
  }

  const now = new Date().toISOString();

  if (!result.ok && result.reason === "not_found") {
    // Pending row was already deleted (likely approved/rejected from the
    // web admin). Mark stale, edit message, ack.
    await supabase
      .from("telegram_admin_messages")
      .update({
        status: "stale",
        resolved_at: now,
        resolved_by_tg_id: fromId,
        resolved_by_username: username || null,
      })
      .eq("id", trackRow.id);

    try {
      await tgApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "⚠️ Already deleted from DB — marked stale",
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.error("[telegram-admin] editMessageText (stale) failed", err?.message);
    }
    await answerCallback(cb.id, "Already gone — marked stale");
    return;
  }

  if (!result.ok) {
    console.error("[telegram-admin] action failed", action, result.reason);
    await answerCallback(cb.id, `Error: ${result.reason}`.slice(0, 200));
    return;
  }

  // Success path — persist resolution and edit the message.
  await supabase
    .from("telegram_admin_messages")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      resolved_at: now,
      resolved_by_tg_id: fromId,
      resolved_by_username: username || null,
    })
    .eq("id", trackRow.id);

  // Rebuild the message body from the previous text so we keep the preview.
  const previousText =
    cb.message?.text || cb.message?.caption || "(event resolved)";
  const header = formatResolvedHeader(action, username, now);
  const newText = `${header}\n\n${esc(previousText)}`;

  try {
    await tgApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: newText.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("[telegram-admin] editMessageText failed", err?.message);
  }

  await answerCallback(
    cb.id,
    action === "approve" ? "Approved ✅" : "Rejected ❌",
  );
}

// ---------------------------------------------------------------------------
// Message / command handler — Stage 2 (registered as stub here)
// ---------------------------------------------------------------------------

async function handleCommand(/* update */) {
  // Stage 2 fills this in.
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  const expected = process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET;
  const got =
    req.headers["x-telegram-bot-api-secret-token"] ||
    req.headers["X-Telegram-Bot-Api-Secret-Token"];
  if (!expected || got !== expected) {
    return res.status(401).json({ ok: false, error: "bad_secret" });
  }

  // Ack immediately so Telegram does not retry; process synchronously after
  // (everything fits in well under the 60s function budget for the volumes
  // we expect — at most a few events per minute).
  res.status(200).json({ ok: true });

  try {
    const update = req.body || {};
    if (update.callback_query) {
      await handleCallback(update);
    } else if (update.message) {
      await handleCommand(update);
    }
  } catch (err) {
    console.error("[telegram-admin] webhook fatal", err);
  }
}
