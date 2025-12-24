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

function parseOkxClaim(line) {
  if (!line) return null;
  const match = /Claim Date:\s*(\d{2})\.(\d{2})\.(\d{4})(?:,\s*(\d{2}):(\d{2}))?/i.exec(line);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const info = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
  if (hour && minute) info.time = `${hour}:${minute}`;
  return info;
}

function parseOkxAlpha(message, channel) {
  const raw = (message.text || '').trim();
  if (!raw.startsWith(channel.emoji)) return [];
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const title = lines[0] || 'OKX Boost X Launch Event';
  const rewardLine = lines.find((line) => line.startsWith('💰')) || null;
  const claimLine = lines.find((line) => line.includes('Claim Date')) || null;
  const { quantity, token } = parseQuantityAndToken(rewardLine);
  const claimInfo = parseOkxClaim(claimLine);
  const startAt = claimInfo ? toIsoFromUtcParts(claimInfo) : null;

  return [
    {
      title,
      description: ensureDescription(lines.slice(1).join('\n')),
      startAt,
      coins: buildCoins(token, quantity),
      coin_name: token || null,
      coin_quantity: quantity,
      type: 'Airdrop',
    },
  ];
}

function parseBinanceClaim(line) {
  if (!line) return null;
  const cleaned = line
    .replace(/^🕑\s*Claim starts:\s*/i, '')
    .replace(/UTC/gi, '')
    .replace(/\(.*?\)/g, '')
    .trim();
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?/i.exec(
    cleaned
  );
  if (!match) return null;
  const [, monthName, dayStr, yearStr, hour, minute] = match;
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
  const claimLine = lines.find((line) => line.includes('Claim starts'));
  const alphaPointsLine = lines.find((line) => line.toLowerCase().startsWith('alpha points'));
  const consumesLine = lines.find((line) => line.toLowerCase().startsWith('consumes'));
  const requirementsIndex = lines.findIndex((line) => line.startsWith('📋'));

  const { quantity, token } = parseQuantityAndToken(amountLine);
  const claimInfo = parseBinanceClaim(claimLine);

  const descriptionParts = [];
  if (alphaPointsLine) descriptionParts.push(alphaPointsLine);
  if (consumesLine && !descriptionParts.includes(consumesLine)) descriptionParts.push(consumesLine);
  if (requirementsIndex !== -1) {
    const reqLines = [];
    for (let i = requirementsIndex; i < lines.length; i += 1) {
      const current = lines[i];
      if (i === requirementsIndex) {
        reqLines.push(current);
        continue;
      }
      if (current.startsWith('🕑')) break;
      reqLines.push(current);
    }
    if (reqLines.length) descriptionParts.push(reqLines.join('\n'));
  }

  const info = claimInfo || null;
  const startAt = info ? (info.hasTime ? toIsoFromUtcParts(info) : toIsoFromKyivDate(info)) : null;

  return [
    {
      title,
      description: ensureDescription(descriptionParts.join('\n\n')),
      startAt,
      coins: buildCoins(token, quantity),
      coin_name: token || null,
      coin_quantity: quantity,
      type: 'Airdrop',
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

function parseIsoLine(line) {
  if (!line) return null;
  const match = /(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/.exec(line);
  if (!match) return null;
  const [, yearStr, monthStr, dayStr, hour, minute] = match;
  const info = {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };
  if (hour && minute) info.time = `${hour}:${minute}`;
  return info;
}

function parseTsBybit(message, channel) {
  const raw = (message.text || '').trim();
  if (!raw.startsWith(channel.emoji)) return [];
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const baseTitle = lines[0];
  const startLine = lines.find((line) => /^Начало:/i.test(line));
  const endLine = lines.find((line) => /^Конец:/i.test(line));
  const newUsersLine = lines.find((line) => /^New users:/i.test(line));
  const tradeLine = lines.find((line) => /^Trade:/i.test(line));
  const rewardLine = lines.find((line) => /Общая награда/i.test(line));

  const startInfo = parseIsoLine(startLine);
  const endInfo = parseIsoLine(endLine);
  const { quantity, token } = parseQuantityAndToken(rewardLine);

  const descriptionParts = [];
  if (newUsersLine) descriptionParts.push(newUsersLine);
  if (tradeLine) descriptionParts.push(tradeLine);
  if (rewardLine) descriptionParts.push(rewardLine);

  const base = {
    description: ensureDescription(descriptionParts.join('\n')),
    coins: buildCoins(token, quantity),
    coin_name: token || null,
    coin_quantity: quantity,
    type: 'Airdrop',
  };

  const events = [];
  if (startInfo) {
    events.push({
      ...base,
      title: `${baseTitle} (Start)`,
      startAt: toIsoFromUtcParts(startInfo),
    });
  }
  if (endInfo) {
    events.push({
      ...base,
      title: `${baseTitle} (End)`,
      startAt: toIsoFromUtcParts(endInfo),
    });
  }
  if (!events.length) {
    events.push({
      ...base,
      title: baseTitle,
      startAt: null,
      notes: ['Не вдалося розпізнати дату старту. Перевірте повідомлення вручну.'],
    });
  }
  return events;
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
  const text = post.text || post.caption || '';
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

      const notes = Array.isArray(parsed.notes) ? [...parsed.notes] : [];
      let startAt = parsed.startAt;
      if (!startAt) {
        startAt = dayjs.unix(message.date).toISOString();
        notes.push('Дата старту не знайдена — використано час публікації повідомлення.');
      }
      const alphaPointsLine = lines.find((line) => line.toLowerCase().startsWith('alpha points'));
      const descriptionParts = [];
      if (amountLine) descriptionParts.push(amountLine);
      if (alphaPointsLine) descriptionParts.push(alphaPointsLine);
      const description = ensureDescription(
        [parsed.description, notes.length ? notes.join('\n') : null].filter(Boolean).join('\n\n')
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
      };

      const inserted = await insertIfMissing(supabase, payload);
      if (inserted) summary.inserted += 1;
      else summary.skipped += 1;
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