/* eslint-env node */
/* global process */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { createClient } from "@supabase/supabase-js";

import { buildPost } from "./lib/eventFormatting.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// Hard cap per cron run, so a one-off backlog does not blow Vercel timeout
// and Telegram rate limits (30 msg/sec to channels, 20 msg/min to groups).
const MAX_PER_RUN = 20;

// Delay between sends to stay well under Telegram limits.
const SEND_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Telegram API
// ---------------------------------------------------------------------------

async function sendTelegramMessage({ token, chatId, text, keyboard }) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new Error(
      `Telegram sendMessage failed: ${res.status} ${json.description || ""}`
    );
    err.response = json;
    err.status = res.status;
    throw err;
  }

  return json.result; // { message_id, ... }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_BROADCAST_CHAT_ID;
  const siteBaseUrl =
    process.env.SITE_BASE_URL || "https://cryptoeventscalendar.com";

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  if (!chatId) {
    throw new Error("Missing TELEGRAM_BROADCAST_CHAT_ID");
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Look back ~7 days only — so a long-running outage doesn't dump dozens of
  // stale events. Tweak via env if you ever need a longer window.
  const lookbackHours = Number(process.env.TG_BROADCAST_LOOKBACK_HOURS || "168");
  const cutoff = dayjs.utc().subtract(lookbackHours, "hour").toISOString();

  const { data: rows, error } = await supabase
    .from("events_approved")
    .select(
      "id,title,description,start_at,end_at,timezone,type,event_type_slug,link,tge_exchanges,coins,coin_name,coin_quantity,coin_price_link,coin_pct_circ,event_usd_value,mcap_usd,show_mcap,created_at,tg_posted_at"
    )
    .is("tg_posted_at", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) throw error;

  const summary = { fetched: rows?.length || 0, sent: 0, failed: 0, errors: [] };

  for (const ev of rows || []) {
    try {
      const { text, keyboard } = buildPost(ev, { siteBaseUrl });

      const result = await sendTelegramMessage({
        token: botToken,
        chatId,
        text,
        keyboard,
      });

      const { error: updErr } = await supabase
        .from("events_approved")
        .update({
          tg_posted_at: new Date().toISOString(),
          tg_message_id: result?.message_id ?? null,
        })
        .eq("id", ev.id);

      if (updErr) throw updErr;

      summary.sent += 1;
      await sleep(SEND_DELAY_MS);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ id: ev.id, message: err?.message || String(err) });

      // 429 => respect retry_after, but only within a single run
      if (err?.status === 429) {
        const retryAfter = Number(err.response?.parameters?.retry_after || 5);
        await sleep(Math.min(retryAfter * 1000, 30_000));
      }
    }
  }

  return summary;
}

import { pathToFileURL } from "node:url";

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run()
    .then((s) => {
      console.log("[telegram-broadcast] done", s);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[telegram-broadcast] fatal", err);
      process.exit(1);
    });
}