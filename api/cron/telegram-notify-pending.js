/* eslint-env node */
/* global process */

// Cron job: every ~5 min, look for pending events that have NOT yet been
// announced to the admin chat, and post one message per row with
// Approve / Reject / Edit-on-site buttons. UNIQUE (pending_id, source) on
// telegram_admin_messages keeps re-runs idempotent.

import { createClient } from "@supabase/supabase-js";
import { buildPost } from "../../scripts/lib/eventFormatting.js";

const TG_TIMEOUT_MS = 10_000;
const SEND_DELAY_MS = 400;
const MAX_PER_RUN = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tgApi(token, method, body) {
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
      err.status = res.status;
      err.response = json;
      throw err;
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

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

async function fetchUnnotified(supabase, source) {
  const table = source === "auto_pending" ? "auto_events_pending" : "events_pending";
  // We can't easily express NOT EXISTS in PostgREST. Two-step approach is
  // fine: fetch a small batch of pending rows, then filter against tracked
  // ones in JS. Pending tables are small (admin should be approving daily).
  const { data: rows, error } = await supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN * 2);
  if (error) throw error;
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.id);
  const { data: tracked, error: trkErr } = await supabase
    .from("telegram_admin_messages")
    .select("pending_id")
    .eq("source", source)
    .in("pending_id", ids);
  if (trkErr) throw trkErr;

  const seen = new Set((tracked || []).map((t) => t.pending_id));
  return rows.filter((r) => !seen.has(r.id));
}

export async function run() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_TG_CHAT_ID;
  const siteUrl = process.env.SITE_URL || "https://cryptoeventscalendar.com";

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!botToken) throw new Error("Missing TELEGRAM_ADMIN_BOT_TOKEN");
  if (!chatId) throw new Error("Missing ADMIN_TG_CHAT_ID");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const summary = { fetched: 0, sent: 0, failed: 0, errors: [] };
  const sources = ["pending", "auto_pending"];

  for (const source of sources) {
    let rows;
    try {
      rows = await fetchUnnotified(supabase, source);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ source, message: err?.message || String(err) });
      continue;
    }

    summary.fetched += rows.length;
    if (!rows.length) continue;

    for (const ev of rows.slice(0, MAX_PER_RUN - summary.sent)) {
      try {
        const { text } = buildPost(ev, {
          siteBaseUrl: siteUrl,
          mode: "admin",
          source,
        });
        const keyboard = buildAdminKeyboard({
          source,
          fullId: ev.id,
          siteUrl,
        });

        const result = await tgApi(botToken, "sendMessage", {
          chat_id: chatId,
          text: text.slice(0, 4000),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: keyboard,
        });

        const { error: insErr } = await supabase
          .from("telegram_admin_messages")
          .insert({
            pending_id: ev.id,
            source,
            tg_chat_id: Number(chatId),
            tg_message_id: result?.message_id,
            status: "awaiting",
          });
        if (insErr) {
          // UNIQUE collision means another run already notified — not fatal.
          if (!String(insErr.message || "").includes("duplicate")) {
            throw insErr;
          }
        }

        summary.sent += 1;
        await sleep(SEND_DELAY_MS);
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          id: ev.id,
          source,
          message: err?.message || String(err),
        });
        if (err?.status === 429) {
          const retryAfter = Number(err.response?.parameters?.retry_after || 5);
          await sleep(Math.min(retryAfter * 1000, 30_000));
        }
      }

      if (summary.sent >= MAX_PER_RUN) break;
    }

    if (summary.sent >= MAX_PER_RUN) break;
  }

  return summary;
}

export default async function handler(_req, res) {
  try {
    const summary = await run();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[telegram-admin] notify-pending fatal", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
