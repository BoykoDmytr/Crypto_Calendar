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

const CHANNELS = {
  okxboostx: {
    name: 'OKX Alpha',
    emoji: '🚀',
    parser: parseOkxAlpha,
  },
  alphadropbinance: {
    name: 'Binance Alpha',
    emoji: '🎁',
    parser: parseBinanceAlpha,
  },
  pool_alerts: {
    name: 'Launchpool Alerts',
    emoji: '🔥',
    parser: parseLaunchpool,
  },
  tokensplsh: {
    name: 'TS Bybit',
    emoji: '❗️',
    parser: parseTsBybit,
  },
};

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

function parseUtcDateLine(lines, keyRu) {
  const line = lines.find((entry) => new RegExp(`^${keyRu}\\s*:`, 'i').test(entry));
  if (!line) return null;

  const match = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/i);
  if (!match) return null;

  const dt = dayjs.utc(`${match[1]} ${match[2]}`, 'YYYY-MM-DD HH:mm', true);
  return dt.isValid() ? dt.toISOString() : null;
}

function extractTotalAmount(lines) {
  const line = lines.find((entry) => /^Общая награда\s*:/i.test(entry)) || null;
  if (!line) return null;

  const normalized = decodeEntities(line)
    .replace(/^Общая награда\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripEmoji(normalized);
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

function toIsoFromUtcParts({ year, month, day, time = '00:00' }) {
  if (!year || !month || !day) return null;
  const formatted = `${year}-${pad(month)}-${pad(day)} ${time}`;
  const parsed = dayjs.utc(formatted, 'YYYY-MM-DD HH:mm', true);
  return parsed.isValid() ? parsed.toISOString() : null;
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
  const claim = lines.find((line) => /^Claim Date\b/i.test(line));
  if (!claim) return null;
  const match = /(\d{2}\.\d{2}\.\d{4}),\s*(\d{2}:\d{2})/.exec(claim);
  if (!match) return null;
  const dt = dayjs.tz(`${match[1]} ${match[2]}`, 'DD.MM.YYYY HH:mm', KYIV_TZ);
  if (!dt.isValid()) return null;
  return dt.toISOString();
}

function parseOkxAlpha(message, channel) {
  let text = (message.text || '').trim();
  if (!text.startsWith(channel.emoji)) return [];
  text = stripEmoji(decodeEntities(text));
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const title = lines[0] || 'OKX Boost X Launch Event';
  const amountLine = lines.find((line) => /^Amount\b/i.test(line));
  const alphaPointsLine = lines.find((line) => /^Alpha points\b/i.test(line));
  const { quantity, token } = parseQuantityAndToken(amountLine);
  const startAt = parseClaimDateKyiv(lines);
  if (!startAt) return [];
  const description = [amountLine, alphaPointsLine].filter(Boolean).join('\n');

  const claimKey = dayjs(startAt).tz(KYIV_TZ).format('YYYY-MM-DD HH:mm');
  const titleClean = stripEmoji(title);
  const source = `okx_alpha`;
  const sourceKey = `OKX_ALPHA|${titleClean}|${claimKey}`;

  return [
    {
      title: titleClean,
      description: ensureDescription(description),
      startAt,
      coins: buildCoins(token, quantity),
      coin_name: token || null,
      coin_quantity: quantity,
      source,
      source_key: sourceKey,
      type: 'OKX Alpha',
      event_type_slug: 'okx_alpha',
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

function parseBinanceAlpha(message, channel) {
  const raw = (message.text || '').trim();
  if (!raw.startsWith(channel.emoji)) return [];
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const tokenLineIndex = lines.findIndex((line) => /^Token:/i.test(line));
  if (tokenLineIndex === -1) return [];

  const title = lines[tokenLineIndex].replace(/^Token:\s*/i, '').trim() || 'Binance Alpha Airdrop';
  const amountLine = lines.find((line) => /^Amount\b/i.test(line));
  if (!amountLine) return [];
  const claimLine =
    lines.find((line) => /claim\s+(starts|begins)/i.test(line) || /activity\s+time/i.test(line)) ||
    lines.find((line) => /\d{1,2}\s+[A-Z][a-z]{2}\s+\d{1,2}:\d{2}\s*UTC/i.test(line));
  const alphaPointsLine = lines.find((line) => line.toLowerCase().startsWith('alpha points'));
  

  const { quantity, token } = parseQuantityAndToken(amountLine);
  const claimInfo = parseBinanceClaim(claimLine);

  const descriptionParts = [];
  if (amountLine) descriptionParts.push(amountLine);
  if (alphaPointsLine) descriptionParts.push(alphaPointsLine);

  const info = claimInfo || null;
  const startAt = info
    ? info.hasTime
      ? toIsoFromUtcToKyivParts(info)
      : toIsoFromKyivDate(info)
    : null;
  if (!startAt) return [];
  const todayStart = dayjs().tz(KYIV_TZ).startOf('day');
  if (dayjs(startAt).tz(KYIV_TZ).isBefore(todayStart)) {
    return [];
  }

  let claimDateISO = null;
  if (info) {
    if (info.hasTime) {
      const formatted = `${info.year}-${pad(info.month)}-${pad(info.day)} ${info.time || '00:00'}`;
      const kyivDate = dayjs.utc(formatted, 'YYYY-MM-DD HH:mm', true).tz(KYIV_TZ);
      claimDateISO = kyivDate.isValid() ? kyivDate.format('YYYY-MM-DD') : null;
    } else {
      const kyivDate = dayjs.tz(
        `${info.year}-${pad(info.month)}-${pad(info.day)}`,
        'YYYY-MM-DD',
        KYIV_TZ,
        true
      );
      claimDateISO = kyivDate.isValid() ? kyivDate.format('YYYY-MM-DD') : null;
    }
  }

  const source = token && claimDateISO ? 'binance_alpha' : null;
  const sourceKey = source ? `BINANCE_ALPHA|${token}|${claimDateISO}` : null;

  return [
    {
      title,
      description: ensureDescription(descriptionParts.join('\n\n')),
      startAt,
      coins: buildCoins(token, quantity),
      coin_name: token || null,
      coin_quantity: quantity,
      source,
      source_key: sourceKey,
      type: 'Binance Alpha',
      event_type_slug: 'binance_alpha',
    },
  ];
}

function parseLaunchpoolPart(part) {
  if (!part) return null;
  const match = /(?:(\d{1,2}):(\d{2}))?\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/.exec(part);
  if (!match) return null;
  const [, hour, minute, dayStr, monthStr, yearStr] = match;
  const info = {
    day: Number(dayStr),
    month: Number(monthStr),
  };
  if (hour && minute) info.time = `${hour.padStart(2, '0')}:${minute}`;
  if (yearStr) info.year = Number(yearStr);
  return info;
}

function parseLaunchpoolDuration(line, referenceDate) {
  if (!line) return { startAt: null, endAt: null };
  const cleaned = line.replace(/^📆\s*Duration:\s*/i, '').replace(/UTC/gi, '').trim();
  const [startRaw, endRaw] = cleaned.split('-').map((part) => part.trim());
  const reference = dayjs.unix(referenceDate).tz(KYIV_TZ);

  const startInfo = parseLaunchpoolPart(startRaw);
  if (!startInfo) return { startAt: null, endAt: null };
  startInfo.year = startInfo.year || guessYear(startInfo.month, startInfo.day, reference);
  const startAt = startInfo.time ? toIsoFromUtcParts(startInfo) : toIsoFromKyivDate(startInfo);

  let endAt = null;
  if (endRaw) {
    const endInfo = parseLaunchpoolPart(endRaw);
    if (endInfo) {
      endInfo.year = endInfo.year || startInfo.year;
      let candidate = endInfo.time ? toIsoFromUtcParts(endInfo) : toIsoFromKyivDate(endInfo);
      if (candidate && startAt && dayjs(candidate).isBefore(dayjs(startAt))) {
        endInfo.year += 1;
        candidate = endInfo.time ? toIsoFromUtcParts(endInfo) : toIsoFromKyivDate(endInfo);
      }
      endAt = candidate;
    }
  }

  return { startAt, endAt };
}

function parseLaunchpool(message, channel) {
  const raw = (message.text || '').trim();
  if (!raw.startsWith(channel.emoji)) return [];
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const title = lines[0];
  const rewardLine = lines.find((line) => line.startsWith('🔢')) || null;
  const poolsLine = lines.find((line) => line.startsWith('🪙')) || null;
  const durationLine = lines.find((line) => line.startsWith('📆')) || null;

  const { quantity, token } = parseQuantityAndToken(rewardLine);
  const { startAt, endAt } = parseLaunchpoolDuration(durationLine, message.date);

  const descriptionParts = [];
  if (poolsLine) descriptionParts.push(poolsLine);
  if (rewardLine) descriptionParts.push(rewardLine);
  if (durationLine) descriptionParts.push(durationLine);

  return [
    {
      title,
      description: ensureDescription(descriptionParts.join('\n')),
      startAt,
      endAt,
      coins: buildCoins(token, quantity),
      coin_name: token || null,
      coin_quantity: quantity,
      type: 'Airdrop',
    },
  ];
}

function parseTsBybitEvent(rawText) {
  const text = stripEmoji(decodeEntities(rawText || ''));
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  if (!lines.length) return null;

  const firstLine = lines[0];
  const isNew = /\bnew\b/i.test(firstLine);
  if (!isNew) return null;

  const bad = [
    /Награды были распределены/i,
    /лежат у участников на балансе/i,
    /rewards (were|have been) distributed/i,
    /already (credited|distributed)/i,
  ];
  if (bad.some((re) => re.test(text))) return null;

  const startIso = parseUtcDateLine(lines, 'Начало');
  const endIso = parseUtcDateLine(lines, 'Конец');
  if (!endIso) return null;

  const totalAmount = extractTotalAmount(lines);

  let ticker = null;
  const tickerMatch = decodeEntities(firstLine).match(/\$?([A-Z0-9]{2,10})\b/);
  if (tickerMatch) ticker = tickerMatch[1];

  const title = ticker ? `New Token Splash ${ticker}` : cleanTitle(firstLine);

  const fmtUtc = (iso) => `${dayjs(iso).utc().format('YYYY-MM-DD HH:mm')} UTC`;
  const descriptionLines = [];
  if (startIso) descriptionLines.push(`Start Date: ${fmtUtc(startIso)}`);
  descriptionLines.push(`End Date: ${fmtUtc(endIso)}`);
  if (totalAmount) descriptionLines.push(`Total Amount: ${totalAmount}`);

  const description = descriptionLines.join('\n');

  return {
    title,
    description,
    startAt: endIso,
    endAt: endIso,
    start_date_iso: startIso,
    end_date_iso: endIso,
    timezone: 'UTC',
    type: 'TS BYBIT',
    event_type_slug: 'ts_bybit',
  };
}

  function parseTsBybit(message, channel) {
  const raw = (message.text || '').trim();
  if (!raw.startsWith(channel.emoji)) return [];

  const parsed = parseTsBybitEvent(raw);
  if (!parsed) return [];

  const todayUtcStart = dayjs.utc().startOf('day');
  if (dayjs(parsed.startAt).isBefore(todayUtcStart)) return [];

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

    const parsedEvents = channel.parser(message, channel) || [];
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

      const payload = {
        title: parsed.title,
        description,
        start_at: startAt,
        end_at: parsed.endAt || null,
        timezone: parsed.timezone || 'Kyiv',
        type: parsed.type || 'Airdrop',
        link,
        coins: parsed.coins || null,
        coin_name: parsed.coin_name || null,
        coin_quantity: parsed.coin_quantity !== undefined ? parsed.coin_quantity : null,
        coin_price_link: parsed.coin_price_link || null,
        source: parsed.source || null,
        source_key: parsed.source_key || null,
        event_type_slug: parsed.event_type_slug || null,
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

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});