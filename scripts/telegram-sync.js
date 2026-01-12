/* eslint-env node */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { createClient } from '@supabase/supabase-js';

// Configure dayjs
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const KYIV_TZ = 'Europe/Kyiv';
const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

// Mapping of Telegram channel usernames to parsers.  Instead of relying on a
// leading emoji (which can be inconsistent due to hidden characters), we
// define a `trigger` string that must appear in the first line of the
// message.  The matching is case‑insensitive and ignores emojis/HTML entities.
// Mapping of Telegram channel usernames to parsers. Each entry defines a human‑readable name,
// a trigger string that should appear in the first line of the post, and the parser that
// should be invoked for that channel.  The `trigger` field is used by the parser itself
// via the `matchesTrigger` helper.  When adding new channels, set the trigger to the
// lowercase phrase that identifies the posts from that channel.
const CHANNELS = {
  okxboostx: {
    name: 'OKX Alpha',
    trigger: 'new okx boost x launch event',
    parser: parseOkxAlpha,
  },
  alphadropbinance: {
    name: 'Binance Alpha',
    trigger: 'new binance alpha airdrop',
    parser: parseBinanceAlpha,
  },
  launchpool_alerts: {
    name: 'Launchpool Alerts',
    trigger: 'stake',
    parser: parseLaunchpoolAlerts,
  },
  tokensplsh: {
    name: 'TS Bybit',
    trigger: 'new token splash:',
    parser: parseTsBybit,
  },
  crypto_hornet_listings: {
    name: 'Crypto Hornet Listings',
    trigger: 'new binance alpha airdrop',
    parser: parseBinanceAlpha,
  },
};

// In addition to channel‑specific parsers, we maintain a list of *all* event parsers.  This
// allows the synchronization logic to attempt multiple parsers on the same message if the
// primary parser fails.  Each entry in this array is a function reference.  The order
// matters: parsers are tried in sequence and the first one that returns a non‑empty
// result will be used.  Note that we intentionally do *not* specify a trigger here; when
// attempting a fallback parse the channel's trigger is ignored.
const ALL_PARSERS = [
  parseBinanceAlpha,
  parseOkxAlpha,
  parseTsBybit,
  parseLaunchpoolAlerts,
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function decodeEntities(text) {
  if (!text) return text;
  return text
    .replace(/&#0*36;/g, '$')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripEmoji(text) {
  return (text || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanTitle(raw) {
  let title = stripEmoji(decodeEntities(raw || ''));
  title = title.replace(/^[^A-Za-z0-9]+/g, '').trim();
  title = title.replace(/#[\w-]+/g, '').trim();
  title = title.replace(/\s*:\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  title = title.replace(/^new\s+token\s+splash\b/i, 'New Token Splash');
  return title;
}

function monthNameToNumber(name) {
  if (!name) return null;
  return MONTHS[name.toLowerCase()] || null;
}

function guessYear(month, day, reference = dayjs().tz(KYIV_TZ)) {
  if (!month || !day) return reference.year();
  let year = reference.year();
  let candidate = dayjs.tz({ year, month: month - 1, date: day, hour: 0, minute: 0 }, KYIV_TZ);
  if (!candidate.isValid()) return year;
  if (candidate.isBefore(reference.subtract(7, 'day'))) {
    year += 1;
    candidate = dayjs.tz({ year, month: month - 1, date: day, hour: 0, minute: 0 }, KYIV_TZ);
  }
  return candidate.isValid() ? candidate.year() : year;
}

function toIsoFromUtcToKyivParts({ year, month, day, time = '00:00' }) {
  if (!year || !month || !day) return null;
  const formatted = `${year}-${pad(month)}-${pad(day)} ${time}`;
  const parsed = dayjs.utc(formatted, 'YYYY-MM-DD HH:mm', true).tz(KYIV_TZ);
  return parsed.isValid() ? parsed.toISOString() : null;
}

function toIsoFromKyivDate({ year, month, day, time = '00:00' }) {
  if (!year || !month || !day) return null;
  const formatted = `${year}-${pad(month)}-${pad(day)} ${time}`;
  const parsed = dayjs.tz(formatted, 'YYYY-MM-DD HH:mm', KYIV_TZ, true);
  return parsed.isValid() ? parsed.toISOString() : null;
}

function parseQuantityAndToken(line) {
  if (!line) return {};
  const quantityMatch = [...line.matchAll(/(\d[\d\s.,]*)/g)].pop();
  let quantity = null;
  if (quantityMatch) {
    const normalized = quantityMatch[1].replace(/\s+/g, '').replace(/,/g, '');
    const num = Number(normalized);
    if (Number.isFinite(num)) quantity = num;
  }
  const tokenMatch = [...line.matchAll(/\$?([A-Z0-9]{2,})\b/g)].pop();
  const token = tokenMatch ? tokenMatch[1] : null;
  return { quantity, token };
}

function buildCoins(token, quantity) {
  const entry = {};
  if (token) entry.name = token;
  if (quantity !== null && quantity !== undefined) entry.quantity = quantity;
  return Object.keys(entry).length ? [entry] : null;
}

function ensureDescription(text) {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length ? trimmed : null;
}

function parseClaimDateKyiv(lines) {
  if (!lines?.length) return null;
  // Find a line containing "Claim Date" anywhere, not just at the start.  Some
  // channels embed the claim date within a longer line of text.  Use a
  // case‑insensitive search.
  const claim = lines.find((line) => /Claim\s+Date/i.test(line));
  if (!claim) return null;
  // Extract DD.MM.YYYY and HH:MM from the found line
  const match = /(\d{2}\.\d{2}\.\d{4}),\s*(\d{2}:\d{2})/.exec(claim);
  if (!match) return null;
  const dt = dayjs.tz(`${match[1]} ${match[2]}`, 'DD.MM.YYYY HH:mm', KYIV_TZ);
  if (!dt.isValid()) return null;
  return dt.toISOString();
}

function normalizeSpaces(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")      // NBSP -> space
    .replace(/[ \t]{2,}/g, " ")   // стискаємо тільки пробіли/таби, НЕ \n
    .trim();
}

/**
 * Determine whether the first line of a message matches the configured trigger for a channel.
 * Many Telegram posts include leading emojis or HTML entities; this helper strips those
 * decorations and performs a case‑insensitive substring search on the cleaned first line.
 *
 * If no trigger is defined on the channel, this always returns true.
 *
 * @param {string} rawText The raw message text (may include newlines).
 * @param {object} channel The channel configuration, which may contain a `trigger` string.
 * @returns {boolean} Whether the trigger is present in the first line.
 */
function matchesTrigger(rawText, channel) {
  if (!channel || !channel.trigger) return true;
  const trigger = String(channel.trigger).toLowerCase();
  const firstLine = (rawText || '').split('\n')[0];
  // decode HTML entities and strip emojis from the first line
  const cleaned = normalizeSpaces(stripEmoji(decodeEntities(firstLine))).toLowerCase();
  return cleaned.includes(trigger);
}


function parseOkxEventDateLine(lines, label) {
  const line = lines.find((l) => new RegExp(`^${label}\\s*:`, "i").test(l));
  if (!line) return null;

  const m = line.match(/:\s*(\d{2}\.\d{2}\.\d{4})\s*,\s*(\d{2}:\d{2})/);
  if (!m) return null;

  // IMPORTANT: це Київський час
  const dt = dayjs.tz(`${m[1]} ${m[2]}`, "DD.MM.YYYY HH:mm", KYIV_TZ, true);
  return dt.isValid() ? dt.toISOString() : null;
}



export function parseOkxAlpha(message, channel) {
  let raw = (message.text || '');
  // Use trigger matching instead of leading emoji.  If the trigger is not present
  // in the first line, skip this message.
  if (!matchesTrigger(raw, channel)) return [];

  // Важливо: не нормалізуємо весь текст, щоб не вбити \n
  raw = decodeEntities(raw);

  // розбиваємо на рядки, і вже КОЖЕН рядок чистимо
  const lines = raw
    .split("\n")
    .map((l) => normalizeSpaces(stripEmoji(l)))
    .filter(Boolean);

  if (!lines.length) return [];

  // 1) Vision беремо з рядка "Vision X Launch" (після stripEmoji)
  // важливо: шукаємо саме "X Launch" як окремий заголовок, а не текст "Event"
  const launchLine = lines.find((l) => /\bX\s+Launch\b/i.test(l) && !/Event/i.test(l)) || null;

  const vision = launchLine
    ? normalizeSpaces(launchLine.replace(/\bX\s+Launch\b/i, "").trim())
    : null;

  // 2) Title
  const title = vision
    ? `${vision} OKX Boost X Launch Event!`
    : "OKX Boost X Launch Event!";


  // 3) Pool беремо з "Total Rewards:"
  const rewardsLine = lines.find((l) => /^Total Rewards\s*:/i.test(l)) || null;
  let poolText = null;
  let quantity = null;
  let token = null;

  if (rewardsLine) {
    // приклад: "Total Rewards: 6 170 000 VSNV"
    poolText = normalizeSpaces(rewardsLine.replace(/^Total Rewards\s*:\s*/i, ''));
    const parsed = parseQuantityAndToken(poolText);
    quantity = parsed.quantity ?? null;
    token = parsed.token ?? null;
  }

  // 4) Claim Date = дата початку (startAt)
  const claimIso = parseClaimDateKyiv(lines);
  if (!claimIso) return [];

  // 5) End Date беремо з "X Launch Ends:"
  const endIso = parseOkxEventDateLine(lines, 'X Launch Ends');
  const endFmt = endIso ? dayjs(endIso).tz(KYIV_TZ).format('DD.MM.YYYY, HH:mm') : null;

  // 6) Формуємо description тільки як просиш
  // Pool: ...
  // End Date: ...
  const descriptionParts = [];
  if (poolText) descriptionParts.push(`Pool: ${poolText}`);
  if (endFmt) descriptionParts.push(`End Date: ${endFmt}`);

  // source_key як було (по claim date)
  const claimKey = dayjs(claimIso).tz(KYIV_TZ).format('YYYY-MM-DD HH:mm');
  const source = 'okx_alpha';
  const sourceKey = `OKX_ALPHA|${title}|${claimKey}`;

  return [
    {
      title,
      description: ensureDescription(descriptionParts.join('\n')),
      startAt: claimIso,           // <-- Claim Date як startAt
      endAt: endIso || null,       // (не обов’язково, але корисно)
      coins: buildCoins(token, quantity),
      coin_name: token || null,
      coin_quantity: quantity,
      source,
      source_key: sourceKey,
      type: 'OKX Alpha',
      event_type_slug: 'okx-alpha', // ВАЖЛИВО: у тебе slug з дефісом!
      coin_price_link: null,
    },
  ];
}


function parseBinanceClaim(line) {
  if (!line) return null;
  const cleaned = line
    .replace(/^🕑\s*(Claim starts|Claim begins|Activity time):\s*/i, '')
    .replace(/UTC/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/,\s*/g, ' ')
    .trim();
  const monthPattern = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  let match = new RegExp(
    `\\b${monthPattern}\\s+(\\d{1,2})(?:\\s+(\\d{4}))?(?:\\s+(\\d{1,2}):(\\d{2}))?`,
    'i'
  ).exec(cleaned);
  let monthName;
  let dayStr;
  let yearStr;
  let hour;
  let minute;
  if (match) {
    [, monthName, dayStr, yearStr, hour, minute] = match;
  } else {
    match = new RegExp(
      `\\b(\\d{1,2})\\s+${monthPattern}(?:\\s+(\\d{4}))?(?:\\s+(\\d{1,2}):(\\d{2}))?`,
      'i'
    ).exec(cleaned);
    if (!match) return null;
    [, dayStr, monthName, yearStr, hour, minute] = match;
  }
  const month = monthNameToNumber(monthName);
  const day = Number(dayStr);
  const year = yearStr ? Number(yearStr) : guessYear(month, day);
  const info = { year, month, day };
  if (hour && minute) info.time = `${hour.padStart(2, '0')}:${minute}`;
  info.hasTime = Boolean(hour && minute);
  return info;
}

export function parseBinanceAlpha(message, channel) {
  const raw = (message.text || '');
  // Match based on the configured trigger rather than emoji. If the first
  // line does not contain the trigger, skip this message.
  if (!matchesTrigger(raw, channel)) return [];
  const lines = raw.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const tokenLineIndex = lines.findIndex((line) => /^Token:/i.test(line));
  if (tokenLineIndex === -1) return [];
  const tokenLine = lines[tokenLineIndex].replace(/^Token:\s*/i, '').trim();

  // Extract the human‑readable token name (before any parenthetical ticker symbol)
  let tokenName = tokenLine;
  const parenIdx = tokenName.indexOf('(');
  if (parenIdx > 0) {
    tokenName = tokenName.slice(0, parenIdx).trim();
  }
  // Build a more descriptive title combining the token name and the event type
  const title = tokenName ? `${tokenName} Binance Alpha Airdrop` : 'Binance Alpha Airdrop';

  // Locate the amount line. Some messages use "Amount", others use "You've earned" (or typographic variations)
  const amountLineRaw = lines.find((line) => {
    const normalized = line.replace(/’/g, "'");
    return /^Amount\b/i.test(normalized) || /^You'?ve\s+earned\b/i.test(normalized);
  });
  // amountLineRaw is optional.  Some posts only provide the token name and claim date.

  // Attempt to parse quantity and token ticker from the raw amount line
  // Extract quantity and token ticker from the amount line, if present
  const { quantity, token: amountToken } = parseQuantityAndToken(amountLineRaw);
  // Format the amount line consistently (e.g. "Amount: 320 tokens")
  let amountLine = null;
  if (Number.isFinite(quantity)) {
    // Use integer quantity if available and pluralize "token" accordingly
    const unit = quantity === 1 ? 'token' : 'tokens';
    amountLine = `Amount: ${quantity} ${unit}`;
  } else {
    amountLine = amountLineRaw;
  }

  // Find Alpha points line (case insensitive)
  const alphaPointsLine = lines.find((line) => line.toLowerCase().startsWith('alpha points')) || null;

  // Determine claim line to extract the event date/time
  const claimLine =
    lines.find((line) => /claim\s+(starts|begins)/i.test(line) || /activity\s+time/i.test(line)) ||
    lines.find((line) => /\d{1,2}\s+[A-Z][a-z]{2}\s+\d{1,2}:\d{2}\s*UTC/i.test(line)) ||
    null;
  

  const claimInfo = parseBinanceClaim(claimLine);

  // Compute the ISO startAt timestamp. If claimInfo is missing, fall back to the message timestamp.
  let startAt = null;
  if (claimInfo) {
    startAt = claimInfo.hasTime
      ? toIsoFromUtcToKyivParts(claimInfo)
      : toIsoFromKyivDate(claimInfo);
  } else if (message.date) {
    // Telegram API provides "date" as a Unix timestamp (seconds). Convert to Kyiv timezone.
    const dt = dayjs.unix(message.date).tz(KYIV_TZ);
    startAt = dt.isValid() ? dt.toISOString() : null;
  }
  // If we still don't have a valid date, skip this message
  if (!startAt) return [];
  const todayStart = dayjs().tz(KYIV_TZ).startOf('day');
  if (dayjs(startAt).tz(KYIV_TZ).isBefore(todayStart)) {
    return [];
  }

  // Format a human‑readable date/time for inclusion in the description (DD.MM.YYYY HH:mm)
  const dateStr = dayjs(startAt).tz(KYIV_TZ).format('DD.MM.YYYY HH:mm');

  // Assemble description lines
  const descriptionParts = [];
  if (amountLine) descriptionParts.push(amountLine);
  if (alphaPointsLine) descriptionParts.push(alphaPointsLine);
  descriptionParts.push(`Date: ${dateStr}`);

  // Determine the ticker from the Token line if we couldn't parse one from the amount line
  let ticker = null;
  const tickerMatch = tokenLine.match(/\(\s*\$?([A-Za-z0-9]{2,})\s*\)/);
  if (tickerMatch) ticker = tickerMatch[1].toUpperCase();

  // Use the token parsed from the amount line if available; otherwise fall back to the ticker from the
  // "Token:" line.  This value will be used for the coin fields and source key.
  const finalToken = amountToken || ticker || null;

  // Determine unique source key if token and date info exist

  let claimDateISO = null;
  if (claimInfo) {
    if (claimInfo.hasTime) {
      const formatted = `${claimInfo.year}-${pad(claimInfo.month)}-${pad(claimInfo.day)} ${claimInfo.time || '00:00'}`;
      const kyivDate = dayjs.utc(formatted, 'YYYY-MM-DD HH:mm', true).tz(KYIV_TZ);
      claimDateISO = kyivDate.isValid() ? kyivDate.format('YYYY-MM-DD') : null;
    } else {
      const kyivDate = dayjs.tz(
        `${claimInfo.year}-${pad(claimInfo.month)}-${pad(claimInfo.day)}`,
        'YYYY-MM-DD',
        KYIV_TZ,
        true
      );
      claimDateISO = kyivDate.isValid() ? kyivDate.format('YYYY-MM-DD') : null;
    }
  }

  const source = finalToken && claimDateISO ? 'binance_alpha' : null;
  const sourceKey = source ? `BINANCE_ALPHA|${finalToken}|${claimDateISO}` : null;

  return [
    {
      title,
      description: ensureDescription(descriptionParts.join('\n')),
      startAt,
      coins: buildCoins(finalToken, quantity),
      coin_name: finalToken || null,
      coin_quantity: quantity,
      source,
      source_key: sourceKey,
      type: 'Binance Alpha',
      event_type_slug: 'binance-alpha',
    },
  ];
}

function parseUtcIsoFromLine(line) {
  // очікуємо: "Start: 2026-01-08 10:00 UTC"
  const m = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/i);
  if (!m) return null;
  const dt = dayjs.utc(`${m[1]} ${m[2]}`, "YYYY-MM-DD HH:mm", true);
  return dt.isValid() ? dt.toISOString() : null;
}

function parseQuotaLine(line) {
  // "Quota: 985.5K VIRTUAL"
  const m = line.match(/Quota:\s*([0-9][0-9.,]*\s*[KMB]?)\s+([A-Z0-9_-]{2,})/i);
  if (!m) return { qty: null, token: null };

  const qtyText = m[1].replace(/\s+/g, "").toUpperCase();
  const token = m[2].toUpperCase();

  // перетворимо K/M/B у число (опційно)
  const mult = qtyText.endsWith("K") ? 1e3 : qtyText.endsWith("M") ? 1e6 : qtyText.endsWith("B") ? 1e9 : 1;
  const numPart = qtyText.replace(/[KMB]$/i, "");
  const qty = Number(numPart.replace(/,/g, ""));
  const quantity = Number.isFinite(qty) ? qty * mult : null;

  return { qtyText, quantity, token };
}

export function parseLaunchpoolAlerts(message, channel) {
  let raw = (message.text || '');
  // Match based on trigger instead of emoji.  If trigger is defined and not found,
  // skip this message.  If trigger is undefined, accept any message.
  if (!matchesTrigger(raw, channel)) return [];

  raw = decodeEntities(raw);

  const lines = raw
    .split("\n")
    .map((l) => normalizeSpaces(stripEmoji(l)))
    .filter(Boolean);

  if (!lines.length) return [];

  // 1) Перший рядок: "Stake VIRTUAL with 100.00% APR (Non-VIP) (link)"
  const first = lines[0];

  // title: обрізаємо все після " ("
  const title = first.replace(/\s*\(.+$/g, "").trim();

  // 2) APR, Period, Quota, Start, End
  const aprLine = lines.find((l) => /^APR\s*:/i.test(l)) || null;
  const periodLine = lines.find((l) => /^Period\s*:/i.test(l)) || null;
  const quotaLine = lines.find((l) => /^Quota\s*:/i.test(l)) || null;
  const startLine = lines.find((l) => /^Start\s*:/i.test(l)) || null;
  const endLine = lines.find((l) => /^End\s*:/i.test(l)) || null;

  const startAt = startLine ? parseUtcIsoFromLine(startLine) : null;
  const endAt = endLine ? parseUtcIsoFromLine(endLine) : null;
  if (!startAt) return []; // без старту не створюємо івент

  // description: тільки APR + Period
  const descParts = [];
  if (aprLine) descParts.push(aprLine);
  if (periodLine) descParts.push(periodLine);

  // coin: Quota
  let coin_name = null;
  let coin_quantity = null;
  let coins = null;

  if (quotaLine) {
    const { quantity, token } = parseQuotaLine(quotaLine);
    coin_name = token;
    coin_quantity = quantity;
    coins = buildCoins(coin_name, coin_quantity);
  }

  // slug для типу "launchpool" (у тебе в event_types є launchpool)
  const event_type_slug = "launchpool";

  // type: щоб сайт показував як Launchpool
  const type = "Launchpool";

  // source_key: стабільний дедуп по title+startAt
  const source = "launchpool_alerts";
  const source_key = `LAUNCHPOOL|${title}|${dayjs(startAt).utc().format("YYYY-MM-DD HH:mm")}`;

  return [
    {
      title,
      description: ensureDescription(descParts.join("\n")),
      startAt,
      endAt: endAt || null,
      coins,
      coin_name,
      coin_quantity,
      source,
      source_key,
      type,
      event_type_slug,
      coin_price_link: null,
      link: null,
    },
  ];
}


export function parseTsBybitEvent(rawText) {
  // Decode HTML entities and strip emojis, but preserve the overall line structure.  Telegram
  // sometimes collapses multiple fields onto a single line, so we cannot rely solely on
  // splitting by newlines.  Instead we search for keywords within the entire text.
  const decoded = decodeEntities(rawText || '');
  const text = stripEmoji(decoded);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  if (!lines.length) return null;

  const firstLine = lines[0];
  // The post should include the word "new" to indicate a new splash event
  if (!/\bnew\b/i.test(firstLine)) return null;

  // Skip posts that announce distribution of rewards
  const bad = [
    /Награды были распределены/i,
    /лежат у участников на балансе/i,
    /rewards (were|have been) distributed/i,
    /already (credited|distributed)/i,
  ];
  if (bad.some((re) => re.test(text))) return null;

  // Extract Start and End times from the entire decoded text.  Sometimes "Начало" and
  // "Конец" appear in the middle of a line, so use regex on the full string.
  const mStart = decoded.match(/Начало:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*UTC/i);
  const mEnd = decoded.match(/Конец:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*UTC/i);

  const startIso = mStart
    ? dayjs.utc(mStart[1], 'YYYY-MM-DD HH:mm', true).toISOString()
    : null;
  const endIso = mEnd
    ? dayjs.utc(mEnd[1], 'YYYY-MM-DD HH:mm', true).toISOString()
    : null;
  // Without an end date we cannot compute the duration of the event
  if (!endIso) return null;

  // Start at defaults to startIso when present; otherwise endIso
  const startAt = startIso || endIso;

  // Extract ticker from the first line after the colon in "New token splash" phrase.
  let ticker = null;
  const t1 = firstLine.match(/\$([A-Z0-9]{2,20})/i);
  const t2 = firstLine.match(/token\s+splash:\s*\$?([A-Z0-9]{2,20})/i);
  ticker = (t1?.[1] || t2?.[1] || null);
  if (ticker) ticker = ticker.toUpperCase();
  const title = ticker ? `New token splash: ${ticker}` : cleanTitle(firstLine);

  // Determine the pool amount and token.  We search the entire decoded text for either
  // "Общая награда:" or "Trade:" followed by a number and token.  This covers both
  // Russian and English variants.  The number may include spaces or commas.
  const mPool =
    decoded.match(/Общая\s+наград(?:а|ы):\s*([0-9][0-9\s,.]*)\s*\$?([A-Z0-9_-]{2,})/i) ||
    decoded.match(/Trade:\s*([0-9][0-9\s,.]*)\s*\$?([A-Z0-9_-]{2,})/i) ||
    null;

  let poolLine = null;
  let coin_name = null;
  let coin_quantity = null;
  let coins = null;
  if (mPool) {
    const qtyDisplay = mPool[1].trim().replace(/\u00A0/g, ' ');
    const token = (mPool[2] || '').replace(/\$/g, '').toUpperCase();
    poolLine = `Pool: ${qtyDisplay} ${token}`;
    // For numerical quantity, remove spaces and commas
    const qtyNumStr = qtyDisplay.replace(/\s+/g, '').replace(/,/g, '');
    const qtyNum = Number(qtyNumStr);
    if (Number.isFinite(qtyNum)) {
      coin_name = token;
      coin_quantity = qtyNum;
      coins = buildCoins(coin_name, coin_quantity);
    }
  }

  // Compose the date line: include both start and end if start date exists
  const fmtUtc = (iso) => `${dayjs(iso).utc().format('YYYY-MM-DD HH:mm')} UTC`;
  let dateLine;
  if (startIso) {
    dateLine = `Date: ${fmtUtc(startIso)} - ${fmtUtc(endIso)}`;
  } else {
    dateLine = `Date: ${fmtUtc(endIso)}`;
  }

  const descriptionParts = [];
  if (poolLine) descriptionParts.push(poolLine);
  descriptionParts.push(dateLine);
  const description = ensureDescription(descriptionParts.join('\n'));

  return {
    title,
    description,
    startAt,
    endAt: endIso || null,
    coins,
    coin_name,
    coin_quantity,
    timezone: 'UTC',
    type: 'TS BYBIT',
    event_type_slug: 'ts-bybit',
  };
}

 export function parseTsBybit(message, channel) {
  const raw = (message.text || '');
  // Use trigger matching instead of emoji.  If the trigger is not present, skip.
  if (!matchesTrigger(raw, channel)) return [];

  const parsed = parseTsBybitEvent(raw);
  // If parsing failed, return an empty array
  if (!parsed) return [];
  // Do not filter out events based on their start date.  The caller (run())
  // may decide whether to skip old events.  Returning the parsed event here
  // allows for better visibility during development and testing.
  return [parsed];
}

function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

async function insertIfMissing(supabase, payload) {
  const { data, error } = await supabase
    .from('auto_events_pending')
    .select('id')
    .eq('title', payload.title)
    .eq('start_at', payload.start_at)
    .eq('link', payload.link)
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return false;

  const clean = cleanPayload(payload);
  const { error: insertError } = await supabase.from('auto_events_pending').insert(clean);
  if (insertError) throw insertError;
  return true;
}

async function upsertPendingBySourceKey(supabase, payload) {
  const { data: existing, error: findErr } = await supabase
    .from('auto_events_pending')
    .select('id')
    .eq('source', payload.source)
    .eq('source_key', payload.source_key)
    .limit(1);

  if (findErr) throw findErr;

  if (existing && existing.length) {
    const id = existing[0].id;
    const patch = { ...payload };
    Object.keys(patch).forEach((key) => {
      if (patch[key] === undefined) delete patch[key];
    });

    const { error: updErr } = await supabase.from('auto_events_pending').update(patch).eq('id', id);
    if (updErr) throw updErr;
    return { action: 'updated', id };
  }

  const { data: insData, error: insErr } = await supabase
    .from('auto_events_pending')
    .insert(payload)
    .select('id')
    .single();
  if (insErr) throw insErr;
  return { action: 'inserted', id: insData.id };
}

function readState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeState(filePath, state) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

async function fetchUpdates(token, offset) {
  const params = new URLSearchParams();
  if (offset) params.set('offset', String(offset));
  params.set('limit', '100');
  params.set('allowed_updates', JSON.stringify(['channel_post', 'edited_channel_post']));

  const url = `https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${text}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API response not ok: ${JSON.stringify(payload)}`);
  }
  return payload.result || [];
}

function normalizeMessage(update) {
  const post = update.channel_post || update.edited_channel_post;
  if (!post || !post.chat || !post.chat.username) return null;
  let text = post.text || post.caption || '';
  text = decodeEntities(text);
  const usernameRaw = post.chat.username;
  return {
    id: post.message_id,
    text,
    date: post.date,
    username: typeof usernameRaw === 'string' ? usernameRaw.toLowerCase() : null,
    originalUsername: usernameRaw,
  };
}

async function run() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_STATE_FILE,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided.');
  }
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN must be provided.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const statePath = path.resolve(process.cwd(), TELEGRAM_STATE_FILE || '.telegram-updates.json');
  const state = readState(statePath);
  let offset = state.offset ? Number(state.offset) : undefined;

  const updates = await fetchUpdates(TELEGRAM_BOT_TOKEN, offset);
  if (!updates.length) {
    console.log('No new updates.');
    return;
  }

  let maxUpdateId = offset || 0;
  const perChannelSummary = new Map();

  for (const update of updates) {
    if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;
    const message = normalizeMessage(update);
    if (!message) continue;

    const channel = CHANNELS[message.username];
    if (!channel) continue;

    // Try to parse the message using the channel's primary parser.  If it
    // returns an empty array, iterate over all parsers in sequence until one
    // produces a result.  This allows us to handle cases where the channel
    // configuration or trigger does not match the actual post, yet another
    // parser is capable of understanding the message.
    let parsedEvents = channel.parser(message, channel) || [];
    if (!parsedEvents.length) {
      for (const parserFn of ALL_PARSERS) {
        // Skip the primary parser since we already tried it
        if (parserFn === channel.parser) continue;
        try {
          // Pass an empty channel object so that matchesTrigger() does not
          // require a trigger to be present
          const res = parserFn(message, {});
          if (res && res.length) {
            parsedEvents = res;
            break;
          }
        } catch (err) {
          // If a parser throws, log and continue with the next parser
          console.warn('Parser error', parserFn.name, err?.message || err);
        }
      }
    }
    // If no parser handled this message, skip it entirely.  We intentionally
    // avoid inserting a generic fallback event so that unrecognized posts do
    // not clutter the pending list.
    if (!parsedEvents.length) continue;

    const slug = message.originalUsername || message.username;
    const link = `https://t.me/${slug}/${message.id}`;
    const summary = perChannelSummary.get(message.username) || { inserted: 0, skipped: 0, total: 0 };

    for (const parsed of parsedEvents) {
      if (!parsed || !parsed.title) continue;
      summary.total += 1;

      let startAt = parsed.startAt;
      if (!startAt) {
        summary.skipped += 1;
        continue;
      }

      const description = ensureDescription(
        [parsed.description].filter(Boolean).join('\n\n')
      );

      // Require both type and event_type_slug; otherwise skip this parsed event.
      const parsedType = parsed.type || null;
      const parsedSlug = parsed.event_type_slug || null;
      if (!parsedType || !parsedSlug) {
        summary.skipped += 1;
        continue;
      }

      const payload = {
        title: parsed.title,
        description,
        start_at: startAt,
        end_at: parsed.endAt || null,
        timezone: parsed.timezone || 'Kyiv',
        type: parsedType,
        link,
        coins: parsed.coins || null,
        coin_name: parsed.coin_name || null,
        coin_quantity: parsed.coin_quantity !== undefined ? parsed.coin_quantity : null,
        coin_price_link: parsed.coin_price_link || null,
        source: parsed.source || null,
        source_key: parsed.source_key || null,
        event_type_slug: parsedSlug,
      };

      if (payload.source && payload.source_key) {
        const result = await upsertPendingBySourceKey(supabase, payload);
        if (result.action === 'inserted') summary.inserted += 1;
        else summary.skipped += 1;
      } else {
        const inserted = await insertIfMissing(supabase, payload);
        if (inserted) summary.inserted += 1;
        else summary.skipped += 1;
      }
    }

    perChannelSummary.set(message.username, summary);
  }

  if (maxUpdateId) {
    writeState(statePath, { offset: maxUpdateId + 1 });
  }

  if (perChannelSummary.size) {
    const table = Array.from(perChannelSummary.entries()).map(([username, stats]) => ({
      channel: username,
      parsed: stats.total,
      inserted: stats.inserted,
      skipped: stats.skipped,
    }));
    console.table(table);
  }
}

import { pathToFileURL } from "node:url";
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}