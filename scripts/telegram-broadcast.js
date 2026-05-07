/* eslint-env node */
/* global process */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = "Europe/Kyiv";

// Hard cap per cron run, so a one-off backlog does not blow Vercel timeout
// and Telegram rate limits (30 msg/sec to channels, 20 msg/min to groups).
const MAX_PER_RUN = 20;

// Delay between sends to stay well under Telegram limits.
const SEND_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Time helpers (mirror src/utils/eventTime.js so card and TG post agree)
// ---------------------------------------------------------------------------

function toEventLocal(isoUtc, tz) {
  if (!isoUtc) return null;
  const d = dayjs.utc(isoUtc);
  if (!d.isValid()) return null;
  if (tz === "Kyiv") return d.tz(KYIV_TZ);
  return d;
}

function eventHasTime(isoUtc, tz) {
  const local = toEventLocal(isoUtc, tz);
  if (!local) return false;
  return local.hour() !== 0 || local.minute() !== 0;
}

function formatWhen(ev) {
  const tz = ev.timezone || "UTC";
  const start = toEventLocal(ev.start_at, tz);
  if (!start) return "";

  const isTGE = ev.type === "Listing (TGE)";
  const hasStartTime = eventHasTime(ev.start_at, tz);

  if (isTGE) {
    return start.format(hasStartTime ? "DD MMM YYYY, HH:mm" : "DD MMM YYYY");
  }

  const end = ev.end_at ? toEventLocal(ev.end_at, tz) : null;
  const hasEndTime = end ? eventHasTime(ev.end_at, tz) : false;

  if (end && !start.isSame(end, "day")) {
    const left = start.format(hasStartTime ? "DD MMM HH:mm" : "DD MMM");
    const right = end.format(hasEndTime ? "DD MMM HH:mm" : "DD MMM");
    return `${left} → ${right}`;
  }

  let label = start.format(hasStartTime ? "DD MMM YYYY, HH:mm" : "DD MMM YYYY");
  if (end && hasEndTime) label += ` – ${end.format("HH:mm")}`;
  return label;
}

// ---------------------------------------------------------------------------
// Coins / numbers helpers
// ---------------------------------------------------------------------------

function parseCoinsField(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 12 }).format(num);
}

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  const opts =
    num < 1
      ? { style: "currency", currency: "USD", maximumFractionDigits: 6 }
      : { style: "currency", currency: "USD", maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-US", opts).format(num);
}

function formatMcapPercent(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.0001) return "<0.0001%";
  if (abs >= 1) return `${n.toFixed(2)}%`;
  if (abs >= 0.1) return `${n.toFixed(3)}%`;
  if (abs >= 0.01) return `${n.toFixed(4)}%`;
  return `${n.toFixed(6).replace(/\.?0+$/, "")}%`;
}

// First non-empty pct from "\n"-separated coin_pct_circ string.
function firstPctFromList(text) {
  if (!text || typeof text !== "string") return null;
  const first = text.split("\n").map((s) => s.trim()).find(Boolean);
  if (!first) return null;
  const n = Number(first.replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// HTML escaping for Telegram (parse_mode=HTML)
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Build the post text + inline keyboard
// ---------------------------------------------------------------------------

function buildPost(ev, { siteBaseUrl }) {
  const lines = [];

  lines.push(`<b>${esc(ev.title || "Untitled")}</b>`);

  // Type + date row
  const meta = [];
  if (ev.type) meta.push(esc(ev.type));
  const when = formatWhen(ev);
  if (when) meta.push(`🕒 ${esc(when)}`);
  if (meta.length) lines.push(meta.join(" · "));

  // Description
  if (ev.description) {
    const trimmed = String(ev.description).trim();
    if (trimmed) {
      lines.push("");
      lines.push(esc(trimmed));
    }
  }

  // Coins block
  const coins = parseCoinsField(ev.coins);
  if (coins.length) {
    lines.push("");
    coins.forEach((coin, idx) => {
      const parts = [];
      const qty = formatNumber(coin?.quantity);
      if (qty) parts.push(qty);
      if (coin?.name) parts.push(esc(coin.name));

      // Per-coin USD only for the first coin, since event_usd_value is the
      // primary one in the DB schema.
      if (idx === 0 && parts.length) {
        const usd = formatUsd(ev.event_usd_value);
        if (usd) parts.push(`≈ ${usd}`);
      }

      if (parts.length) lines.push(`💰 ${parts.join(" ")}`);
    });

    // %MCAP (first coin only — same as the card)
    if (ev.show_mcap !== false) {
      const pct =
        coins[0]?.pct_circ != null
          ? Number(coins[0].pct_circ)
          : firstPctFromList(ev.coin_pct_circ);
      const pctLabel = formatMcapPercent(pct);
      if (pctLabel) lines.push(`📊 MCAP: ${esc(pctLabel)}`);
    }
  }

  // Exchanges (sorted by time)
  if (Array.isArray(ev.tge_exchanges) && ev.tge_exchanges.length) {
    const sorted = [...ev.tge_exchanges].sort((a, b) => {
      const ta = a?.time || "99:99";
      const tb = b?.time || "99:99";
      return ta.localeCompare(tb);
    });
    const chips = sorted
      .map((ex) => {
        const name = ex?.name ? esc(ex.name) : "";
        const time = ex?.time ? ` • ${esc(ex.time)}` : "";
        return name ? `${name}${time}` : null;
      })
      .filter(Boolean);
    if (chips.length) {
      lines.push("");
      lines.push(`🏦 ${chips.join(" | ")}`);
    }
  }

  // External link (official site/announcement)
  if (ev.link) {
    lines.push("");
    lines.push(`🔗 <a href="${esc(ev.link)}">Офіційне посилання</a>`);
  }

  // ---- Inline keyboard ----
  const calendarUrl = `${siteBaseUrl.replace(/\/+$/, "")}/?event=${ev.id}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: "📅 Відкрити в календарі", url: calendarUrl }],
    ],
  };

  return { text: lines.join("\n"), keyboard };
}

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