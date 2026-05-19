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
import dns from "node:dns";

import {
  approvePendingEvent,
  rejectPendingEvent,
} from "../../scripts/lib/approveEvent.js";
import { buildPost, esc } from "../../scripts/lib/eventFormatting.js";

// Force IPv4 first for DNS lookups. Vercel fra1 advertises IPv6 but
// api.telegram.org from that subnet often hangs on v6 → ETIMEDOUT after the
// connect timeout. Node's fetch (built on undici) calls dns.lookup under the
// hood, which respects this setting. No external package needed.
dns.setDefaultResultOrder("ipv4first");

dayjs.extend(utc);
dayjs.extend(timezone);

const TG_TIMEOUT_MS = 5_000;

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

// Never let a slow / hung Telegram call propagate out of the handler.
// api.telegram.org from Vercel fra1 occasionally takes >10s to respond,
// and that has been the proximate cause of "webhook fatal DOMException" /
// "query too old" loops in the logs.
async function safeTg(method, body, label = method) {
  try {
    return await tgApi(method, body);
  } catch (err) {
    console.error(`[telegram-admin] ${label} failed`, err?.message);
    return null;
  }
}
const safeAnswerCallback = (id, text, opts = {}) =>
  safeTg(
    "answerCallbackQuery",
    { callback_query_id: id, text, ...opts },
    `answerCallback(${text})`,
  );

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
    await safeAnswerCallback(cb.id, "Not authorized");
    return;
  }

  const data = String(cb.data || "");
  // Expected: "a:<source>:<short_id>" or "r:<source>:<short_id>"
  const m = /^([ar]):(pending|auto_pending):([a-f0-9]{4,12})$/i.exec(data);
  if (!m) {
    await safeAnswerCallback(cb.id, "Unknown action");
    return;
  }

  const action = m[1] === "a" ? "approve" : "reject";
  const source = m[2];
  const shortId = m[3].toLowerCase();
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (!chatId || !messageId) {
    await safeAnswerCallback(cb.id, "Missing chat/message ids");
    return;
  }

  const supabase = getSupabase();

  // Look up the tracking row by (chat_id, message_id) — the source of truth
  // for the full pending UUID.
  const { data: trackRow, error: trackErr } = await supabase
    .from("telegram_admin_messages")
    .select("id, pending_id, source, status, resolved_at, resolved_by_username")
    .eq("tg_chat_id", chatId)
    .eq("tg_message_id", messageId)
    .maybeSingle();

  if (trackErr || !trackRow) {
    await safeAnswerCallback(cb.id, "Tracking row missing");
    console.error("[telegram-admin] tracking lookup failed", trackErr?.message);
    return;
  }

  if (trackRow.source !== source) {
    await safeAnswerCallback(cb.id, "Source mismatch");
    return;
  }

  // Defense in depth: short_id must prefix the stored UUID.
  if (!String(trackRow.pending_id).toLowerCase().startsWith(shortId)) {
    await safeAnswerCallback(cb.id, "ID mismatch");
    return;
  }

  if (trackRow.status !== "awaiting") {
    const by = trackRow.resolved_by_username
      ? `@${trackRow.resolved_by_username}`
      : "someone";
    await safeAnswerCallback(cb.id, `Already ${trackRow.status} by ${by}`);
    return;
  }

  // No DB-level lease. Two reasons:
  //
  // 1) PostgREST `.or(resolved_at.is.null,resolved_at.lt.<iso>)` chokes on
  //    the dots inside an ISO timestamp (`.000Z`) — the parser reads them
  //    as additional operator boundaries and the API returns an error,
  //    which is what produced the "Lock error" toast in the bot.
  // 2) approvePendingEvent is already idempotent via the UNIQUE
  //    (source, source_key) index on events_approved. If two concurrent
  //    clicks both make it past the status check, the loser's INSERT hits
  //    23505, gets reported as alreadyApproved, and we end up with
  //    exactly one approved row + one broadcast — the actual user-visible
  //    invariant we care about.
  //
  // So: nothing to claim here. Costs a duplicate Dropstab/MEXC call in
  // the rare double-tap case, which is cheap compared to the operational
  // headache of a half-claimed row.

  // Ack the click up-front so the spinner stops within Telegram's 15s
  // budget, even if the heavy work below takes a while.
  await safeAnswerCallback(
    cb.id,
    action === "approve" ? "Approving…" : "Rejecting…",
  );

  // Execute action.
  let result;
  try {
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
  } catch (err) {
    result = { ok: false, reason: err?.message || String(err) };
  }

  if (!result.ok && result.reason === "not_found") {
    // Pending row was already deleted (likely approved/rejected from the
    // web admin). Mark stale.
    await supabase
      .from("telegram_admin_messages")
      .update({
        status: "stale",
        resolved_at: new Date().toISOString(),
        resolved_by_tg_id: fromId,
        resolved_by_username: username || null,
      })
      .eq("id", trackRow.id);

    await safeTg(
      "editMessageText",
      {
        chat_id: chatId,
        message_id: messageId,
        text: "⚠️ Already deleted from DB — marked stale",
        parse_mode: "HTML",
        disable_web_page_preview: true,
      },
      "editMessageText (stale)",
    );
    return;
  }

  if (!result.ok) {
    console.error("[telegram-admin] action failed", action, result.reason);
    // status stayed 'awaiting' for the whole run, so there's nothing to
    // roll back — the message keeps its Approve/Reject buttons and the
    // admin can retry as soon as the underlying problem is fixed.
    await safeTg(
      "editMessageText",
      {
        chat_id: chatId,
        message_id: messageId,
        text: `⚠️ Failed: ${esc(result.reason).slice(0, 200)}`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      },
      "editMessageText (error)",
    );
    return;
  }

  // Success — commit the terminal status now that the work has actually
  // landed in events_approved.
  const resolvedAt = new Date().toISOString();
  await supabase
    .from("telegram_admin_messages")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      resolved_at: resolvedAt,
      resolved_by_tg_id: fromId,
      resolved_by_username: username || null,
    })
    .eq("id", trackRow.id);

  // Rebuild the message body from the previous text so we keep the preview.
  const previousText =
    cb.message?.text || cb.message?.caption || "(event resolved)";
  const header = formatResolvedHeader(action, username, resolvedAt);
  const newText = `${header}\n\n${esc(previousText)}`;

  await safeTg(
    "editMessageText",
    {
      chat_id: chatId,
      message_id: messageId,
      text: newText.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    "editMessageText",
  );
}

// ---------------------------------------------------------------------------
// Command handlers
//
// Commands work in DM only. In groups, Telegram appends `@botname` to the
// command text, so we accept that form too but reject otherwise (groups can
// be noisy, we don't want every "/stats" in some random chat to fire).
// ---------------------------------------------------------------------------

function buildAdminKeyboard({ source, fullId, siteUrl }) {
  const shortId = String(fullId).replace(/-/g, "").slice(0, 8);
  const focusUrl = `${siteUrl.replace(/\/+$/, "")}/admin?focus=${fullId}`;
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `a:${source}:${shortId}` },
        { text: "❌ Reject", callback_data: `r:${source}:${shortId}` },
      ],
      [{ text: "✏ Edit on site", url: focusUrl }],
    ],
  };
}

function todayUtcStart() {
  return dayjs.utc().startOf("day").toISOString();
}

async function sendText(chatId, text, extra = {}) {
  return tgApi("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function cmdHelp(chatId) {
  const text = [
    "<b>Available commands</b>",
    "",
    "/pending — show up to 10 oldest pending events with action buttons",
    "/stats — totals: approved, pending, approved today, broadcasts today",
    "/today — events posted to the public channel today",
    "/help — this list",
  ].join("\n");
  await sendText(chatId, text);
}

async function cmdPending(chatId, supabase) {
  const siteUrl = process.env.SITE_URL || "https://cryptoeventscalendar.com";
  const adminChatId = Number(process.env.ADMIN_TG_CHAT_ID || chatId);

  const [pendRes, autoRes] = await Promise.all([
    supabase
      .from("events_pending")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(10),
    supabase
      .from("auto_events_pending")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(10),
  ]);

  const items = [];
  for (const r of pendRes.data || []) items.push({ ev: r, source: "pending" });
  for (const r of autoRes.data || []) items.push({ ev: r, source: "auto_pending" });

  if (!items.length) {
    await sendText(chatId, "No pending events right now ✅");
    return;
  }

  const top = items.slice(0, 10);
  for (const { ev, source } of top) {
    const { text } = buildPost(ev, { siteBaseUrl: siteUrl, mode: "admin", source });
    const keyboard = buildAdminKeyboard({
      source,
      fullId: ev.id,
      siteUrl,
    });
    try {
      const result = await sendText(chatId, text, { reply_markup: keyboard });
      // Insert tracking row only when posting to the canonical admin chat —
      // /pending replies in DMs would otherwise collide on the UNIQUE
      // (pending_id, source) constraint.
      if (result?.message_id && Number(chatId) === adminChatId) {
        await supabase
          .from("telegram_admin_messages")
          .insert({
            pending_id: ev.id,
            source,
            tg_chat_id: Number(chatId),
            tg_message_id: result.message_id,
            status: "awaiting",
          })
          .then(() => null, () => null); // ignore duplicate
      }
    } catch (err) {
      console.error("[telegram-admin] /pending send failed", err?.message);
    }
  }
}

async function cmdStats(chatId, supabase) {
  const todayStart = todayUtcStart();

  const [totalApproved, pendingCount, autoPendingCount, approvedToday, broadcastsToday] =
    await Promise.all([
      supabase.from("events_approved").select("id", { count: "exact", head: true }),
      supabase.from("events_pending").select("id", { count: "exact", head: true }),
      supabase.from("auto_events_pending").select("id", { count: "exact", head: true }),
      supabase
        .from("events_approved")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart),
      supabase
        .from("events_approved")
        .select("id", { count: "exact", head: true })
        .gte("tg_posted_at", todayStart),
    ]);

  const lines = [
    "<b>Stats</b>",
    "",
    `Total approved: <b>${totalApproved.count ?? 0}</b>`,
    `Pending (manual): <b>${pendingCount.count ?? 0}</b>`,
    `Pending (auto): <b>${autoPendingCount.count ?? 0}</b>`,
    `Approved today: <b>${approvedToday.count ?? 0}</b>`,
    `Broadcasts today: <b>${broadcastsToday.count ?? 0}</b>`,
  ];

  await sendText(chatId, lines.join("\n"));
}

async function cmdToday(chatId, supabase) {
  const todayStart = todayUtcStart();
  const siteUrl = process.env.SITE_URL || "https://cryptoeventscalendar.com";
  const base = siteUrl.replace(/\/+$/, "");

  const { data, error } = await supabase
    .from("events_approved")
    .select("id, title, type, tg_posted_at")
    .gte("tg_posted_at", todayStart)
    .order("tg_posted_at", { ascending: false })
    .limit(50);

  if (error) {
    await sendText(chatId, `Error: ${esc(error.message)}`);
    return;
  }

  if (!data?.length) {
    await sendText(chatId, "No broadcasts today.");
    return;
  }

  const lines = ["<b>Broadcast today</b>", ""];
  for (const ev of data) {
    const t = dayjs.utc(ev.tg_posted_at).format("HH:mm");
    const title = esc(ev.title || "(untitled)");
    const url = `${base}/admin?focus=${ev.id}`;
    lines.push(`• <code>${t}</code> ${title} — <a href="${url}">edit</a>`);
  }

  await sendText(chatId, lines.join("\n"));
}

async function handleCommand(update) {
  const msg = update.message;
  const fromId = msg?.from?.id;
  const text = String(msg?.text || "").trim();
  if (!text.startsWith("/")) return;
  if (!isAdmin(fromId)) return; // silent — do not leak bot existence

  const chatType = msg.chat?.type;
  // In groups, only respond when @botname is appended.
  const botName = (process.env.TELEGRAM_ADMIN_BOT_USERNAME || "").toLowerCase();
  const tokens = text.split(/\s+/);
  let cmd = tokens[0].toLowerCase();
  const atIdx = cmd.indexOf("@");
  if (atIdx >= 0) {
    const target = cmd.slice(atIdx + 1);
    cmd = cmd.slice(0, atIdx);
    if (chatType !== "private" && botName && target !== botName) return;
  } else if (chatType !== "private") {
    return;
  }

  const chatId = msg.chat?.id;
  const supabase = getSupabase();

  try {
    if (cmd === "/help" || cmd === "/start") {
      await cmdHelp(chatId);
    } else if (cmd === "/pending") {
      await cmdPending(chatId, supabase);
    } else if (cmd === "/stats") {
      await cmdStats(chatId, supabase);
    } else if (cmd === "/today") {
      await cmdToday(chatId, supabase);
    }
    // unknown commands: silently ignored
  } catch (err) {
    console.error("[telegram-admin] command failed", cmd, err?.message);
  }
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

  // Process FIRST, respond AFTER. Sending the response early "fire and
  // forget" looked like it should work, but in practice Vercel's runtime
  // tends to freeze the function the moment res.end() runs — that's been
  // killing the approve flow mid-step (CAS commits "approved", then the
  // events_approved insert dies before it completes, leaving the tracking
  // row in a half-resolved state). Telegram is happy with anything inside
  // a 60s window, and Vercel's maxDuration is 30s, so doing the work
  // synchronously is safer than racing the runtime.
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

  res.status(200).json({ ok: true });
}
