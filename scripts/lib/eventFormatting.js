/* eslint-env node */
// Shared formatter for Telegram posts. Imported by both the public broadcast
// (scripts/telegram-broadcast.js) and the admin notify cron
// (api/cron/telegram-notify-pending.js).
//
// Stays a leaf module: no Supabase, no env vars. Just `buildPost(ev, opts)`.

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = "Europe/Kyiv";

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

export function formatWhen(ev) {
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

export function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Also escape quotes: esc() output is used inside attribute values too
    // (e.g. <a href="...">), where an unescaped " would break out of the
    // attribute and let a crafted link inject extra markup into the post.
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Build the post text + (public) inline keyboard
// ---------------------------------------------------------------------------

/**
 * @param ev   Event row from events_approved / events_pending / auto_events_pending.
 * @param opts
 *   - siteBaseUrl: site origin (used to build the "Open in calendar" button)
 *   - mode: 'public' (default) — broadcast keyboard with calendar link
 *           'admin'  — appends Source + submitter nickname, returns no
 *                      keyboard (caller builds its own approve/reject set).
 *   - source: ('pending' | 'auto_pending') — only relevant for mode='admin'.
 */
export function buildPost(ev, { siteBaseUrl = "", mode = "public", source } = {}) {
  const lines = [];

  lines.push(`<b>${esc(ev.title || "Untitled")}</b>`);

  const meta = [];
  if (ev.type) meta.push(esc(ev.type));
  const when = formatWhen(ev);
  if (when) meta.push(`🕒 ${esc(when)}`);
  if (meta.length) lines.push(meta.join(" · "));

  if (ev.description) {
    const trimmed = String(ev.description).trim();
    if (trimmed) {
      lines.push("");
      lines.push(esc(trimmed));
    }
  }

  const coins = parseCoinsField(ev.coins);
  if (coins.length) {
    lines.push("");
    coins.forEach((coin, idx) => {
      const parts = [];
      const qty = formatNumber(coin?.quantity);
      if (qty) parts.push(qty);
      if (coin?.name) parts.push(esc(coin.name));

      if (idx === 0 && parts.length) {
        const usd = formatUsd(ev.event_usd_value);
        if (usd) parts.push(`≈ ${usd}`);
      }

      if (parts.length) lines.push(`💰 ${parts.join(" ")}`);
    });

    if (ev.show_mcap !== false) {
      const pct =
        coins[0]?.pct_circ != null
          ? Number(coins[0].pct_circ)
          : firstPctFromList(ev.coin_pct_circ);
      const pctLabel = formatMcapPercent(pct);
      if (pctLabel) lines.push(`📊 MCAP: ${esc(pctLabel)}`);
    }
  }

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

  if (ev.link) {
    lines.push("");
    lines.push(`🔗 <a href="${esc(ev.link)}">Офіційне посилання</a>`);
  }

  if (mode === "admin") {
    const srcTable =
      source === "auto_pending" ? "auto_events_pending" : "events_pending";
    lines.push("");
    lines.push(`<i>Source:</i> <code>${esc(srcTable)}</code>`);
    const nick = (ev.nickname || "").trim();
    if (nick) {
      const at = nick.startsWith("@") ? nick : `@${nick}`;
      lines.push(`<i>Submitter:</i> ${esc(at)}`);
    }
    return { text: lines.join("\n"), keyboard: null };
  }

  const calendarUrl = `${siteBaseUrl.replace(/\/+$/, "")}/?event=${ev.id}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: "📅 Відкрити в календарі", url: calendarUrl }],
    ],
  };

  return { text: lines.join("\n"), keyboard };
}
