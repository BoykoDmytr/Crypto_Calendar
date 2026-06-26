/* eslint-env node */
// Shared parser for Binance "Trading Competition" announcement pages.
//
// Flow: the merlin bot in t.me/CEXpromo posts a headline that links to an
// official Binance Announcement. scripts/telegram-sync.js follows that link,
// fetches the page HTML, and calls buildTournamentEvents() here to turn each
// tournament period (1st / 2nd / ...) into one event for auto_events_pending.
//
// Pure parsing — no Supabase, no env, no API. Just regex over the page HTML.

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = "Europe/Kyiv";

export function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Binance announcement detail pages are a client-rendered SPA: a plain fetch
// returns the shell with the article text embedded as JSON in a <script>
// (e.g. __APP_DATA), not as visible <h1>/<p> markup. stripTags() drops scripts,
// so we also build a second view that KEEPS script/JSON text (with common JSON
// escapes decoded) and search both. SSR'd pages still match via the visible part.
function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\u00a0/g, " ");
}

export function htmlToSearchText(html) {
  const raw = String(html || "");
  const visible = decodeEntities(stripTags(raw));
  const embedded = decodeEntities(
    raw
      .replace(/\\u002[fF]/g, "/")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  return `${visible}\n${embedded}`;
}

// "588,000" / "2,450" / "240" -> 588000 / 2450 / 240
function parseNumber(str) {
  if (str == null) return null;
  const normalized = String(str).replace(/[\s,]/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

// Drop thousands separators for display text (numbers go without commas per spec):
// "594,000" -> "594000"
function stripCommas(str) {
  return str == null ? "" : String(str).replace(/,/g, "");
}

// MEXC price link in the auto format the site form recognizes.
function buildMexcPriceLink(ticker) {
  if (!ticker) return null;
  const symbol = String(ticker).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) return null;
  return `https://www.mexc.com/uk-UA/futures/${symbol}_USDT?lang=uk-UA&_from=search`;
}

// Last valid (TICKER) in parentheses from the announcement <h1>, ignoring dates
// like (2026-05-26).
export function extractTickerFromTitle(title) {
  if (!title) return null;
  const matches = [...String(title).matchAll(/\(([A-Z0-9]{2,15})\)/g)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const candidate = matches[i][1];
    if (/^[A-Z][A-Z0-9]*$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * "The top 2,200 users ... will share 594,000 KGEN tokens equally (= 270 KGEN per user)."
 */
export function parseTournamentRewards(text) {
  const topMatch = text.match(/top\s+([\d,]+)\s+(?:users|participants|traders)/i);

  // per-user reward: "(= 270 KGEN per user)" — tolerate optional $ and spacing.
  const perUserMatch = text.match(
    /\(\s*=?\s*([\d,.]+)\s*\$?([A-Z0-9]{2,15})\s+per\s+user\s*\)/i
  );

  // prize pool — wording varies across announcements:
  //   "share 594,000 KGEN tokens equally", "share a total of 594,000 $KGEN",
  //   "594,000 KGEN tokens equally", etc. Try strict→loose, anchored to "share".
  const poolMatch =
    text.match(
      /share\s+(?:a\s+total\s+of\s+|up\s+to\s+)?([\d,]+)\s*\$?([A-Z0-9]{2,15})\s+tokens?/i
    ) ||
    text.match(/([\d,]{3,})\s*\$?([A-Z0-9]{2,15})\s+tokens?\s+equally/i) ||
    text.match(
      /share\s+(?:a\s+total\s+of\s+|up\s+to\s+)?([\d,]+)\s*\$?([A-Z0-9]{2,15})\b/i
    );

  const topRaw = topMatch ? topMatch[1] : null;
  const poolRaw = poolMatch ? poolMatch[1] : null;
  const perUserRaw = perUserMatch ? perUserMatch[1] : null;
  const ticker =
    (perUserMatch && perUserMatch[2]) || (poolMatch && poolMatch[2]) || null;

  return {
    topRaw,
    poolRaw,
    perUserRaw,
    poolNum: parseNumber(poolRaw),
    perUserNum: parseNumber(perUserRaw),
    ticker: ticker ? ticker.toUpperCase() : null,
  };
}

/**
 * Several tournament periods (1st / 2nd / ...). Matches only the lines that
 * carry "(UTC)" on both dates, e.g.:
 * "1st KGEN Trading Competition Promotion Period: 2026-06-25 13:00 (UTC) to 2026-07-02 13:00 (UTC)"
 */
export function parseTournamentPeriods(text) {
  const re =
    /(\d+(?:st|nd|rd|th))\s+([A-Z0-9]{2,15})\s+Trading\s+Competition\s+Promotion\s+Period\s*:?\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\(UTC\)\s*(?:to|-|–|—)\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\(UTC\)/gi;

  const periods = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, ordinal, ticker, sDate, sTime, eDate, eTime] = m;
    const key = `${ordinal}|${ticker}|${eDate} ${eTime}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const startUtc = dayjs.utc(`${sDate} ${sTime}`, "YYYY-MM-DD HH:mm");
    const endUtc = dayjs.utc(`${eDate} ${eTime}`, "YYYY-MM-DD HH:mm");
    if (!startUtc.isValid() || !endUtc.isValid()) continue;

    periods.push({ ordinal, ticker: ticker.toUpperCase(), startUtc, endUtc });
  }
  return periods;
}

/**
 * Build 1+ events (one per tournament period), shaped for the telegram-sync
 * run() loop (camelCase startAt, coins as a JSON string for the TEXT column).
 *
 * @param {object} args
 * @param {string} args.html         raw announcement page HTML
 * @param {string} args.officialLink URL of the Binance Announcement
 */
export function buildTournamentEvents({ html, officialLink }) {
  const text = htmlToSearchText(html);
  const periods = parseTournamentPeriods(text);
  if (!periods.length) return [];

  const rewards = parseTournamentRewards(text);

  // Diagnostic: if the pool/per-user numbers didn't parse, log the actual
  // wording around "per user" so the regex can be tuned to this announcement.
  if (rewards.poolNum == null || rewards.perUserNum == null) {
    const i = text.search(/per\s+user/i);
    const snippet =
      i >= 0 ? text.slice(Math.max(0, i - 240), i + 40) : text.slice(0, 280);
    console.log(
      `[binance-tournament] rewards: top=${rewards.topRaw} pool=${rewards.poolRaw} perUser=${rewards.perUserRaw} ticker=${rewards.ticker} | ...${snippet}...`
    );
  }

  const h1 = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTicker = extractTickerFromTitle(h1 ? stripTags(h1[1]) : null);

  return periods.map((period) => {
    const ticker = rewards.ticker || period.ticker || titleTicker;
    const mexc = buildMexcPriceLink(ticker);

    // Початок = очікувана роздача = дата завершення турніру + 2 дні, 06:00 Київ.
    const endKyiv = period.endUtc.tz(KYIV_TZ);
    const startKyiv = endKyiv
      .add(2, "day")
      .hour(6)
      .minute(0)
      .second(0)
      .millisecond(0);

    // Числа без ком (за специфікацією).
    const top = stripCommas(rewards.topRaw);
    const pool = stripCommas(rewards.poolRaw);
    const perUser = stripCommas(rewards.perUserRaw);

    const rewardLine =
      top || pool
        ? `Топ ${top} розділять порівну ${pool} ${ticker} (= ${perUser} ${ticker} на користувача).`
        : "";

    const description = [
      rewardLine,
      `Дата закінчення турніру ${endKyiv.format(
        "DD.MM.YYYY HH:mm"
      )}. UPD: Нагороди останнім часом роздають через день, о 6-7 за Києвом. Стежу у боті Binance_Alpha_Competition`,
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    // Рядок 1 — повний фонд, Рядок 2 — нагорода на користувача.
    const coins = [];
    if (rewards.poolNum != null) {
      coins.push({ name: ticker, quantity: rewards.poolNum, price_link: mexc });
    }
    if (rewards.perUserNum != null) {
      coins.push({ name: ticker, quantity: rewards.perUserNum, price_link: mexc });
    }

    return {
      title: `Нагорода за турнір ${period.ordinal} ${ticker}`,
      description: description || null,
      startAt: startKyiv.toISOString(),
      endAt: null,
      timezone: "Kyiv",
      type: "Binance Tournaments",
      event_type_slug: "binance-tournaments",
      link: officialLink || null,
      coin_name: ticker || null,
      coin_quantity: rewards.poolNum,
      coin_price_link: mexc,
      coins: coins.length ? JSON.stringify(coins) : null,
      source: "binance_tournament",
      source_key: `BINANCE_TOURNAMENT|${ticker}|${period.ordinal}|${period.endUtc.format(
        "YYYY-MM-DD HH:mm"
      )}`,
    };
  });
}
