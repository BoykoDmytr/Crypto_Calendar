/* eslint-env node */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = 'Europe/Kyiv';

/**
 * =========================
 * CONFIG: channels + triggers
 * =========================
 */
const CHANNELS = {
  alphadropbinance: {
    username: 'alphadropbinance',
    name: 'Binance Alpha Airdrops',
    trigger: 'New Binance Alpha Airdrop',
    parser: parseBinanceAlpha,
  },
  okxboostx: {
    username: 'okxboostx',
    name: 'OKX Boost',
    trigger: 'New OKX Boost X Launch Event',
    parser: parseOkxAlpha,
  },
  tokensplsh: {
    username: 'tokensplsh',
    name: 'Token Splash Tracker',
    trigger: 'New token splash:',
    parser: parseTsBybit,
  },
  pool_alerts: {
    username: 'pool_alerts',
    name: 'High APR Pools Alerts',
    trigger: null,
    parser: parsePoolAlerts,
  },
};

// Fallback list якщо захочеш додати загальні парсери пізніше
const ALL_PARSERS = [
  { name: 'Binance Alpha', trigger: 'New Binance Alpha Airdrop', fn: parseBinanceAlpha },
  { name: 'OKX Alpha', trigger: 'New OKX Boost X Launch Event', fn: parseOkxAlpha },
  { name: 'Token Splash', trigger: 'New token splash:', fn: parseTsBybit },
  { name: 'Launchpool', trigger: 'Stake', fn: parseLaunchpoolAlerts },
  { name: 'Launchpool (New)', trigger: 'New Launchpool', fn: parseLaunchpoolNew },
];

/**
 * =========================
 * Helpers: text cleaning
 * =========================
 */
function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#0*36;/g, '$')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ');
}

function stripEmoji(s) {
  if (!s) return '';
  // прибираємо emoji + variation selectors
  return s.replace(
    /([\u{1F000}-\u{1FAFF}]|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{FE0F})/gu,
    ''
  );
}

function normalizeSpaces(s) {
  return (s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildMexcExchangeLink(coinName) {
  if (!coinName) return null;
  const raw = String(coinName).trim();
  if (!raw) return null;
  const token = raw.split(/[\s(]/)[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!token) return null;
  return `https://www.mexc.com/uk-UA/exchange/${token}_USDT#token-info`;
}

function ensureDescription(text) {
  if (!text) return null;
  const t = text.trim();
  return t.length ? t : null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function monthNameToNumber(name) {
  const m = String(name).toLowerCase();
  const map = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  return map[m] || null;
}

function guessYear(month, day) {
  // беремо найближчий рік від сьогодні (Kyiv)
  const now = dayjs().tz(KYIV_TZ);
  const y = now.year();
  const candidate = dayjs.tz(`${y}-${pad(month)}-${pad(day)} 00:00`, 'YYYY-MM-DD HH:mm', KYIV_TZ);
  if (candidate.isBefore(now.subtract(6, 'months'))) return y + 1;
  return y;
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

function normalizeTriggerText(s) {
  return normalizeSpaces(stripEmoji(decodeEntities(s)))
    .toLowerCase()
    .replace(/[!?.:|()[\]{}]/g, ' ')   // прибираємо пунктуацію, що часто заважає
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesTrigger(rawText, trigger) {
  if (!trigger) return true;

  const lines = (rawText || '')
    .split('\n')
    .map((l) => normalizeTriggerText(l))
    .filter(Boolean);

  const head = lines.slice(0, 5).join(' ');          // ✅ перші 5 рядків
  const trig = normalizeTriggerText(trigger);

  return head.includes(trig);
}



/**
 * =========================
 * PARSERS (keyword-based)
 * =========================
 */

// OKX date line helper
function parseOkxEventDateLine(lines, label) {
  const line = lines.find((l) => new RegExp(`^${label}\\s*:`, 'i').test(l));
  if (!line) return null;
  const m = line.match(/:\s*(\d{2}\.\d{2}\.\d{4})\s*,\s*(\d{2}:\d{2})/);
  if (!m) return null;
  const dt = dayjs.tz(`${m[1]} ${m[2]}`, 'DD.MM.YYYY HH:mm', KYIV_TZ, true);
  return dt.isValid() ? dt.toISOString() : null;
}

function parseClaimDateKyiv(lines) {
  const claim = lines.find((line) => /claim\s*date/i.test(line));
  if (!claim) return null;

  const m = claim.match(/(\d{2})\.(\d{2})\.(\d{4})\D+(\d{2}):(\d{2})/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const HH = Number(m[4]);
  const Min = Number(m[5]);

  // робимо "наївну" дату
  const isoLike = `${yyyy}-${pad(mm)}-${pad(dd)}T${pad(HH)}:${pad(Min)}:00`;

  // отримуємо offset для Europe/Kyiv на цю дату/час через Intl
  const dt = new Date(`${isoLike}Z`); // базово як UTC точка для розрахунку
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: KYIV_TZ,
    timeZoneName: 'shortOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(dt);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value; // типу "GMT+2"
  if (!tzPart) return null;

  // перетворюємо "GMT+2" -> "+02:00"
  const mo = tzPart.match(/GMT([+-]\d{1,2})/);
  if (!mo) return null;
  const offH = Number(mo[1]);
  const offset = `${offH >= 0 ? '+' : '-'}${pad(Math.abs(offH))}:00`;

  // Повертаємо ISO з офсетом Києва
  return `${isoLike}${offset}`;
}




// OKX
export function parseOkxAlpha(message, channel) {
  const rawText = message.text || '';
  if (!matchesTrigger(rawText, channel?.trigger)) return [];

  const raw = decodeEntities(rawText);
  const lines = raw
    .split('\n')
    .map((l) => normalizeSpaces(stripEmoji(l)))
    .filter(Boolean)
    .filter((line) => !/^Go to Launch\b/i.test(line));
  if (!lines.length) return [];

  const launchLine = lines.find((l) => /X\s+Launch/i.test(l) && !/Event/i.test(l)) || null;


  const vision = launchLine
    ? normalizeSpaces(launchLine.replace(/\bX\s+Launch\b/i, '').trim())
    : null;

  const title = vision ? `${vision} OKX Boost X Launch Event!` : 'OKX Boost X Launch Event!';

  const rewardsLine = lines.find((l) => /^Total Rewards\s*:/i.test(l)) || null;
  const poolLine = lines.find((l) => /^Pool\s*:/i.test(l)) || null;

  let poolText = null;
  let quantity = null;
  let token = null;

  if (rewardsLine || poolLine) {
    const sourceLine = poolLine || rewardsLine;
    poolText = normalizeSpaces(sourceLine.replace(/^(Total Rewards|Pool)\s*:\s*/i, ''));
    const parsed = parseQuantityAndToken(poolText);
    quantity = parsed.quantity ?? null;
    token = parsed.token ?? null;
  }

  // ✅ startAt = Claim Date
  const claimIso = parseClaimDateKyiv(lines);
  console.log('OKX DEBUG lines:', lines);
  console.log('OKX DEBUG claimIso:', claimIso);
  if (!claimIso) return [];

  const requirements = lines
    .filter((line) => /Min\.\s*Boost\s*(Balance|Volume)\s*:/i.test(line))
    .map((line) => normalizeSpaces(line.replace(/^[•\-\s]+/, '').trim()));

  const claimLine = lines.find((line) => /Claim Date\s*:/i.test(line)) || null;
  const claimDescription = claimLine
    ? normalizeSpaces(claimLine.replace(/^Claim Date\s*:\s*/i, '').trim())
    : null;

  // ✅ Description only Pool
  const descriptionParts = [];
  if (poolText) descriptionParts.push(`Pool: ${poolText}`);
  if (requirements.length) descriptionParts.push(`Requirements: ${requirements.join(' • ')}`);
  if (claimDescription) descriptionParts.push(`Claim Date: ${claimDescription}`);
  const description = ensureDescription(descriptionParts.join('\n'));

  const source = 'okx_alpha';
  const sourceKey = `OKX_ALPHA|${title}|${dayjs(claimIso).tz(KYIV_TZ).format('YYYY-MM-DD HH:mm')}`;

  return [{
    title,
    description,
    startAt: claimIso,
    endAt: null,   // ✅ “End Date ...” goes into endAt
    coins: buildCoins(token, quantity),
    coin_name: token || null,
    coin_quantity: quantity,
    source,
    source_key: sourceKey,
    type: 'OKX Alpha',
    event_type_slug: 'okx-alpha',
    coin_price_link: null,
    omitLink: true,
  }];
}


// Binance claim helper
function parseBinanceClaim(line) {
  if (!line) return null;
  const cleaned = line
    .replace(/^(Claim starts|Claim begins|Activity time)\s*:\s*/i, '')
    .replace(/UTC/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/,\s*/g, ' ')
    .trim();

  const monthPattern =
    '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';

  let match = new RegExp(
    `\\b${monthPattern}\\s+(\\d{1,2})(?:\\s+(\\d{4}))?(?:\\s+(\\d{1,2}):(\\d{2}))?`,
    'i'
  ).exec(cleaned);

  let monthName, dayStr, yearStr, hour, minute;

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
  if (hour && minute) info.time = `${String(hour).padStart(2, '0')}:${minute}`;
  info.hasTime = Boolean(hour && minute);
  return info;
}

// Binance Alpha Airdrop
export function parseBinanceAlpha(message, channel) {
  const rawText = message.text || '';
  if (!matchesTrigger(rawText, channel?.trigger)) return [];

  const raw = decodeEntities(rawText);
  const lines = raw.split('\n').map((l) => normalizeSpaces(stripEmoji(l))).filter(Boolean);
  if (!lines.length) return [];

  const tokenLineIndex = lines.findIndex((line) => /^Token:/i.test(line));
  if (tokenLineIndex === -1) return [];

  const tokenLine = lines[tokenLineIndex].replace(/^Token:\s*/i, '').trim();

  let tokenName = tokenLine;
  const parenIdx = tokenName.indexOf('(');
  if (parenIdx > 0) tokenName = tokenName.slice(0, parenIdx).trim();

  const title = tokenName ? `${tokenName} Binance Alpha Airdrop` : 'Binance Alpha Airdrop';

  const amountLineRaw = lines.find((line) => {
    const normalized = line.replace(/’/g, "'");
    return /^Amount\b/i.test(normalized) || /^You'?ve\s+earned\b/i.test(normalized);
  }) || null;

  const { quantity, token: amountToken } = parseQuantityAndToken(amountLineRaw || '');
  const amountLine =
    Number.isFinite(quantity) ? `Amount: ${quantity}` : amountLineRaw;

  const alphaPointsLine =
    lines.find((line) => line.toLowerCase().startsWith('alpha points')) || null;

  const claimLine =
    lines.find((line) => /claim\s+(starts|begins)/i.test(line) || /activity\s+time/i.test(line)) ||
    lines.find((line) => /\d{1,2}\s+[A-Z][a-z]{2}\s+\d{1,2}:\d{2}\s*UTC/i.test(line)) ||
    null;

  const claimInfo = parseBinanceClaim(claimLine);

  // ✅ Date must go into startAt (Kyiv time)
  let startAt = null;
  if (claimInfo) {
    startAt = claimInfo.hasTime
      ? toIsoFromUtcToKyivParts(claimInfo) // UTC -> Kyiv
      : toIsoFromKyivDate(claimInfo);
  } else if (message.date) {
    const dt = dayjs.unix(message.date).tz(KYIV_TZ);
    startAt = dt.isValid() ? dt.toISOString() : null;
  }
  if (!startAt) return [];

  // ✅ Description WITHOUT Date
  const consumesLine = lines.find((line) => /consumes\s*:/i.test(line)) || null;

  const descriptionParts = [];
  if (amountLine) descriptionParts.push(amountLine);
  if (alphaPointsLine) descriptionParts.push(alphaPointsLine);
  if (consumesLine) descriptionParts.push(consumesLine);


  let ticker = null;
  const tickerMatch = tokenLine.match(/\(\s*\$?([A-Za-z0-9]{2,})\s*\)/);
  if (tickerMatch) ticker = tickerMatch[1].toUpperCase();

  const finalToken = amountToken || ticker || null;

  const source = finalToken ? 'binance_alpha' : null;
  const source_key = source
    ? `BINANCE_ALPHA|${finalToken}|${dayjs(startAt).tz(KYIV_TZ).format('YYYY-MM-DD HH:mm')}`
    : null;

  return [{
    title,
    description: ensureDescription(descriptionParts.join('\n')),
    startAt,          // ✅ time goes here
    endAt: null,
    coins: buildCoins(finalToken, quantity),
    coin_name: finalToken || null,
    coin_quantity: quantity ?? null,
    source,
    source_key,
    type: 'Binance Alpha',
    event_type_slug: 'binance-alpha',
    omitLink: true,
  }];
}


// Launchpool helpers
function parseUtcIsoFromLine(line) {
  const m = line?.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/i);
  if (!m) return null;
  const dt = dayjs.utc(`${m[1]} ${m[2]}`, 'YYYY-MM-DD HH:mm', true);
  return dt.isValid() ? dt.toISOString() : null;
}

function parseQuotaLine(line) {
  const m = line?.match(/Quota:\s*([0-9][0-9.,]*\s*[KMB]?)\s+([A-Z0-9_-]{2,})/i);
  if (!m) return { qtyText: null, quantity: null, token: null };
  const qtyText = m[1].replace(/\s+/g, '').toUpperCase();
  const token = m[2].toUpperCase();
  const mult = qtyText.endsWith('K') ? 1e3 : qtyText.endsWith('M') ? 1e6 : qtyText.endsWith('B') ? 1e9 : 1;
  const numPart = qtyText.replace(/[KMB]$/i, '');
  const qty = Number(numPart.replace(/,/g, ''));
  const quantity = Number.isFinite(qty) ? qty * mult : null;
  return { qtyText, quantity, token };
}

// Launchpool Alerts
export function parseLaunchpoolAlerts(message, channel) {
  const rawText = message.text || '';
  if (!matchesTrigger(rawText, channel?.trigger)) return [];

  const raw = decodeEntities(rawText);
  const lines = raw.split('\n').map((l) => normalizeSpaces(stripEmoji(l))).filter(Boolean);
  if (!lines.length) return [];

  const first = lines[0];
  const title = first.replace(/\s*\(.+$/g, '').trim();

  const aprLine = lines.find((l) => /^APR\s*:/i.test(l)) || null;
  const periodLine = lines.find((l) => /Period\s*:/i.test(l)) || null;
  const quotaLine = lines.find((l) => /^Quota\s*:/i.test(l)) || null;
  const startLine = lines.find((l) => /^Start\s*:/i.test(l)) || null;
  const endLine = lines.find((l) => /^End\s*:/i.test(l)) || null;

  const startIso = startLine ? parseUtcIsoFromLine(startLine) : null;
  const endIso = endLine ? parseUtcIsoFromLine(endLine) : null;

  // за твоїм правилом: нам потрібен End
  if (!endIso) return [];

  // ✅ startAt = End
  const startAt = endIso;
  // endAt можеш тримати, але якщо на сайті не треба — лишай null
  const endAt = null;


  const descParts = [];
  if (aprLine) descParts.push(aprLine);
  if (periodLine) descParts.push(periodLine);
  if (startLine) descParts.push(startLine);
  if (endLine) descParts.push(endLine);

  let coin_name = null;
  let coin_quantity = null;
  let coins = null;

  if (quotaLine) {
    const { quantity, token } = parseQuotaLine(quotaLine);
    coin_name = token;
    coin_quantity = quantity;
    coins = buildCoins(coin_name, coin_quantity);
  }

  const source = 'launchpool_alerts';
  const source_key = `LAUNCHPOOL|${title}|${dayjs(startAt).utc().format('YYYY-MM-DD HH:mm')}`;

  return [{
    title,
    description: ensureDescription(descParts.join('\n')),
    startAt,
    endAt: endAt || null,
    coins,
    coin_name,
    coin_quantity,
    source,
    source_key,
    type: 'Launchpool',
    event_type_slug: 'launchpool',
    coin_price_link: null,
  }];
}

function parseLaunchpoolDurationLine(line) {
  const match = line?.match(
    /Duration:\s*(\d{2}:\d{2})\s*(\d{2})\.(\d{2})\s*-\s*(\d{2}:\d{2})\s*(\d{2})\.(\d{2})\s*UTC/i
  );
  if (!match) return null;
  const endTime = match[4];
  const endDay = Number(match[5]);
  const endMonth = Number(match[6]);
  const year = guessYear(endMonth, endDay);
  if (!year) return null;
  const endIso = dayjs
    .utc(`${year}-${pad(endMonth)}-${pad(endDay)} ${endTime}`, 'YYYY-MM-DD HH:mm', true)
    .toISOString();
  return { endIso, endTime, endDay, endMonth };
}

function parseLaunchpoolRewardLine(line) {
  const match = line?.match(/Reward:\s*([0-9][0-9,._]*)\s*([A-Z0-9_-]{2,})/i);
  if (!match) return { quantity: null, token: null };
  const quantityRaw = match[1].replace(/[,_]/g, '');
  const quantity = Number(quantityRaw);
  const token = match[2].toUpperCase();
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    token,
  };
}

export function parseLaunchpoolNew(message, channel) {
  const rawText = message.text || '';
  if (!matchesTrigger(rawText, channel?.trigger)) return [];

  const decoded = decodeEntities(rawText);
  const text = stripEmoji(decoded);
  const lines = text.split('\n').map((line) => normalizeSpaces(line)).filter(Boolean);
  if (!lines.length) return [];

  const firstLine = lines[0];
  const title = normalizeSpaces(firstLine.replace(/\bNew\b\s*/i, '')).trim();

  const poolsLine = lines.find((line) => /^Pools\s*:/i.test(line)) || null;
  const durationLine = lines.find((line) => /^Duration\s*:/i.test(line)) || null;
  const rewardLine = lines.find((line) => /^Reward\s*:/i.test(line)) || null;

  const duration = durationLine ? parseLaunchpoolDurationLine(durationLine) : null;
  if (!duration?.endIso) return [];

  const { quantity, token } = rewardLine ? parseLaunchpoolRewardLine(rewardLine) : { quantity: null, token: null };

  const descParts = [];
  if (poolsLine) descParts.push(poolsLine);
  if (durationLine) descParts.push(durationLine);
  if (duration) {
    descParts.push(`End: ${duration.endTime} ${pad(duration.endDay)}.${pad(duration.endMonth)} UTC`);
  }
  if (rewardLine) descParts.push(rewardLine);

  const source = 'launchpool_alerts';
  const source_key = `LAUNCHPOOL_NEW|${title}|${dayjs(duration.endIso).utc().format('YYYY-MM-DD HH:mm')}`;

  return [{
    title,
    description: ensureDescription(descParts.join('\n')),
    startAt: duration.endIso,
    endAt: null,
    coins: buildCoins(token, quantity),
    coin_name: token,
    coin_quantity: quantity,
    source,
    source_key,
    type: 'Launchpool',
    event_type_slug: 'launchpool',
    coin_price_link: null,
  }];
}

export function parsePoolAlerts(message) {
  return [
    ...parseLaunchpoolAlerts(message, { trigger: 'Stake' }),
    ...parseLaunchpoolNew(message, { trigger: 'New Launchpool' }),
  ];
}

// Token Splash (Bybit) — з title як ти просив: "New token splash: $WHITEWHALE"
export function parseTsBybit(message, channel) {
  const rawText = message.text || '';
  if (!matchesTrigger(rawText, channel?.trigger)) return [];

  const decoded = decodeEntities(rawText);
  const text = stripEmoji(decoded);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const firstLine = lines[0];

  // ✅ Start/End must go into startAt/endAt (UTC)
  const mEnd   = decoded.match(/Конец:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*UTC/i);

  const endIso = mEnd
    ? dayjs.utc(mEnd[1], 'YYYY-MM-DD HH:mm', true).tz(KYIV_TZ).toISOString()
    : null;

  // тобі потрібно чітко мати обидві дати
  if (!endIso) return [];

  // ticker
  const t1 = firstLine.match(/\$([A-Z0-9]{2,20})/i);
  const t2 = firstLine.match(/token\s+splash:\s*\$?([A-Z0-9]{2,20})/i);
  const ticker = (t1?.[1] || t2?.[1] || '').toUpperCase() || null;

  const normalizedFirstLine = normalizeSpaces(firstLine);
  const title = normalizedFirstLine || (ticker ? `Token splash: $${ticker}` : 'Token splash');


  // Pool line
  const mPool =
    decoded.match(/Общая\s+наград(?:а|ы):\s*([0-9][0-9\s,.]*)\s*\$?([A-Z0-9_-]{2,})/i) ||
    null;

  let poolLine = null;
  let coin_name = null;
  let coin_quantity = null;
  let coins = null;

  if (mPool) {
    const qtyDisplay = mPool[1].trim().replace(/\u00A0/g, ' ');
    const token = (mPool[2] || '').replace(/\$/g, '').toUpperCase();
    poolLine = `Pool: ${qtyDisplay} $${token}`;

    const qtyNumStr = qtyDisplay.replace(/\s+/g, '').replace(/,/g, '');
    const qtyNum = Number(qtyNumStr);
    if (Number.isFinite(qtyNum)) {
      coin_name = token;
      coin_quantity = qtyNum;
      coins = buildCoins(coin_name, coin_quantity);
    }
  }

  // ✅ Description WITHOUT Date range
  const description = poolLine ? poolLine : null;

  const source = 'ts_bybit';
  const source_key = ticker
    ? `TS|${ticker}|${dayjs(endIso).utc().format('YYYY-MM-DD HH:mm')}`
    : `TS|${dayjs(endIso).utc().format('YYYY-MM-DD HH:mm')}`;

  return [{
    title,
    description,
    startAt: endIso,   // ✅ 2025-12-29 10:00 UTC -> start
    endAt: null,       // ✅ 2026-01-09 11:00 UTC -> end
    coins,
    coin_name,
    coin_quantity,
    type: 'TS BYBIT',
    event_type_slug: 'ts-bybit',
    source,
    source_key,
    omitLink: true,
  }];
}


/**
 * =========================
 * SUPABASE: insert/upsert + state
 * =========================
 */
function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
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
    const patch = cleanPayload(payload);
    const { error: updErr } = await supabase.from('auto_events_pending').update(patch).eq('id', id);
    if (updErr) throw updErr;
    return { action: 'updated', id };
  }

  const { data: ins, error: insErr } = await supabase
    .from('auto_events_pending')
    .insert(cleanPayload(payload))
    .select('id')
    .single();

  if (insErr) throw insErr;
  return { action: 'inserted', id: ins.id };
}

async function getLastMessageId(supabase, channel) {
  const { data, error } = await supabase
    .from('telegram_ingest_state')
    .select('last_message_id')
    .eq('channel', channel)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.last_message_id ? Number(data.last_message_id) : 0;
}

async function setLastMessageId(supabase, channel, lastId) {
  const payload = { channel, last_message_id: lastId, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('telegram_ingest_state')
    .upsert(payload, { onConflict: 'channel' });
  if (error) throw error;
}

/**
 * =========================
 * SCRAPE: t.me/s/<channel>
 * =========================
 *
 * We parse:
 * - message id from data-post="channel/123"
 * - datetime from <time datetime="...">
 * - text from .tgme_widget_message_text (HTML -> text)
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchChannelHtml(channel) {
  const url = `https://t.me/s/${channel}`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; CryptoCalendarBot/1.0)',
      'accept-language': 'en-US,en;q=0.9,uk;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function extractPostsFromHtml(channel, html) {
  const posts = [];

  // кожен пост має data-post="channel/123"
  const postRegex =
  /data-post="([^"]+\/\d+)"[\s\S]*?class="tgme_widget_message_text[^"]*"[\s\S]*?<\/div>/g;
  let match;

  while ((match = postRegex.exec(html)) !== null) {
    const dataPost = match[1]; // channel/123
    const id = Number(dataPost.split('/')[1]);

    // вирізаємо “кусок” навколо цього поста щоб дістати time + text
    const startIdx = Math.max(0, match.index - 800);
    const endIdx = Math.min(html.length, match.index + 8000);
    const chunk = html.slice(startIdx, endIdx);

    const timeMatch = chunk.match(/<time[^>]+datetime="([^"]+)"/i);
    const datetime = timeMatch ? timeMatch[1] : null;

    const textMatch =
  chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const textHtml = textMatch ? textMatch[1] : '';
    const text = decodeEntities(stripHtml(textHtml));

    posts.push({
      id,
      text,
      dateIso: datetime,
      username: channel,
    });
  }

  // відсортуємо по id зростанням
  posts.sort((a, b) => a.id - b.id);
  return posts;
}

/**
 * =========================
 * RUN
 * =========================
 */
export async function run() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const summary = [];

  for (const key of Object.keys(CHANNELS)) {
    const cfg = CHANNELS[key];
    const channel = cfg.username;

    const lastId = await getLastMessageId(supabase, channel);

    const html = await fetchChannelHtml(channel);
    const posts = extractPostsFromHtml(channel, html);

    // беремо тільки нові
    const newPosts = posts.filter((p) => p.id > lastId);

    let inserted = 0;
    let skipped = 0;
    let maxSeen = lastId;

    for (const p of newPosts) {
      maxSeen = Math.max(maxSeen, p.id);

      const msg = {
        id: p.id,
        text: p.text,
        // для fallback: unix seconds
        date: p.dateIso ? Math.floor(new Date(p.dateIso).getTime() / 1000) : null,
        username: channel,
        originalUsername: channel,
      };

      let parsedEvents = [];
      try {
        parsedEvents = cfg.parser(msg, cfg) || [];
      } catch (e) {
        console.warn('Parser error', channel, e?.message || e);
        continue;
      }

      if (!parsedEvents.length) {
        // fallback cycle (на випадок якщо канал зміниться)
        for (const p2 of ALL_PARSERS) {
          try {
            const res = p2.fn(msg, { trigger: p2.trigger }) || [];
            if (res.length) {
              parsedEvents = res;
              break;
            }
          } catch {}
        }
      }

      if (!parsedEvents.length) {
        skipped++;
        continue;
      }

      const link = `https://t.me/${channel}/${p.id}`;

      for (const ev of parsedEvents) {
        if (!ev?.title || !ev?.startAt || !ev?.type || !ev?.event_type_slug) {
          skipped++;
          continue;
        }
        
        const inferredCoinPriceLink =
          ev.coin_price_link ||
          buildMexcExchangeLink(ev.coin_name || ev.coins?.[0]?.name);

        const payload = {
          title: ev.title,
          description: ensureDescription(ev.description || ''),
          start_at: ev.startAt,
          end_at: ev.endAt || null,
          timezone: ev.timezone || 'Kyiv',
          type: ev.type,
          link: null,
          coins: ev.coins || null,
          coin_name: ev.coin_name || null,
          coin_quantity: ev.coin_quantity ?? null,
          coin_price_link: inferredCoinPriceLink || null,
          source: ev.source || null,
          source_key: ev.source_key || null,
          event_type_slug: ev.event_type_slug,
        };

        // Якщо є source/source_key, перевіряємо чи вже є затверджена подія.
        if (payload.source && payload.source_key) {
          const { data: approved, error: approvedErr } = await supabase
            .from('events_approved')
            .select(
              'id, title, description, start_at, end_at, timezone, type, link, coins, coin_name, coin_quantity, coin_price_link, event_type_slug'
            )
            .eq('event_type_slug', payload.event_type_slug)
            .eq('coin_name', payload.coin_name)
            .eq('start_at', payload.start_at)
            .limit(1);

          if (!approvedErr && approved && approved.length) {
            const existing = approved[0];

            // визначаємо відмінності
            const fields = [
              'title',
              'description',
              'start_at',
              'end_at',
              'timezone',
              'type',
              'link',
              'coins',
              'coin_name',
              'coin_quantity',
              'coin_price_link',
            ];

            const patch = {};
            for (const field of fields) {
              const newVal = payload[field];

              // пропускаємо порожні значення
              if (
                newVal !== undefined &&
                newVal !== null &&
                newVal !== '' &&
                existing[field] !== newVal
              ) {
                patch[field] = newVal;
              }
            }

            // якщо є зміни, записуємо їх в event_edits_pending
            if (Object.keys(patch).length) {
              await supabase.from('event_edits_pending').insert({
                event_id: existing.id,
                payload: patch,
              });
              inserted++;
            } else {
              // нічого не змінилося
              skipped++;
            }
          } else {
            // немає затвердженої події – записуємо у auto_events_pending
            const r = await upsertPendingBySourceKey(supabase, payload);
            if (r.action === 'inserted') inserted++;
            else skipped++;
          }
        } else {          
          // якщо немає source_key — все одно upsert по link+start+title (просто пропускаємо)
          const { data: exists } = await supabase
            .from('auto_events_pending')
            .select('id')
            .eq('title', payload.title)
            .eq('start_at', payload.start_at)
            .eq('link', payload.link)
            .limit(1);

          if (exists && exists.length) skipped++;
          else {
            const { error } = await supabase.from('auto_events_pending').insert(cleanPayload(payload));
            if (error) throw error;
            inserted++;
          }
        }
      }
    }

    // оновлюємо state
    if (maxSeen > lastId) await setLastMessageId(supabase, channel, maxSeen);

    summary.push({ channel, new_posts: newPosts.length, inserted, skipped, last_id: maxSeen });
  }

  console.table(summary);
}

export async function runTelegramSync() {
  return run(); // або просто встав тіло run() і назви її runTelegramSync
}

import { pathToFileURL } from 'node:url';

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runTelegramSync().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}