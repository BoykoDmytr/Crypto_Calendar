/* eslint-env node */
/* global process */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);
dayjs.extend(timezone);

const KYIV_TZ = "Europe/Kyiv";

// 1) Composite list -> щоб знайти catalogId по назві
const DEFAULT_COMPOSITE_URL =
  "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=50";

// 2) Catalog list -> тягнемо тільки Latest Activities
const CATALOG_LIST_URL =
  "https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query";

const TARGET_CATALOG_NAME = "latest activities";

// Фільтр по ключових словах (залишив як в тебе)
const TITLE_KEYWORDS = [
  "Trading Competition",
  // "Competition",
  // "Tournament",
  // "Deposit Campaign",
  // "Campaign",
];

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (vercel-cron)",
      Accept: "application/json,text/html,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      clienttype: "web",
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status} ${url}: ${t.slice(0, 200)}`);
  }
  return res.text();
}

function looksLikeTournament(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return TITLE_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 1) З composite дістаємо catalogId для "Latest Activities"
 */
function getCatalogIdFromComposite(compositeJson) {
  const catalogs = compositeJson?.data?.catalogs || [];
  const target = catalogs.find(
    (c) => (c?.catalogName || "").trim().toLowerCase() === TARGET_CATALOG_NAME
  );
  return target?.catalogId || null;
}

/**
 * 2) З catalog/list/query беремо articles (тільки Latest Activities)
 */
function parseCatalogArticles(catalogJson) {
  // формат у відповіді може бути: data.articles або data (залежно від версії)
  const data = catalogJson?.data;
  const articles = data?.articles || data?.catalog?.articles || [];
  return (articles || [])
    .map((a) => ({
      code: a.code,
      title: a.title,
      releaseDate: a.releaseDate,
    }))
    .filter((a) => a.code && a.title);
}

/**
 * Парсимо сторінку анонсу (HTML) і намагаємось знайти період
 */
function parseAnnouncementPage(html) {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1Match ? stripTags(h1Match[1]) : null;

  const officialMatch = html.match(/href="(https:\/\/www\.binance\.com[^"]+)"/i);
  const officialLink = officialMatch ? officialMatch[1] : null;

  // Більше варіантів “періоду”
  const periodRegexes = [
    // Promotion Period / Promotion Time
    /Promotion\s+(?:Period|Time)\s*:?[\s\S]*?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)[\s\S]*?(?:to|-)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)/i,
    // Activity Period / Activity Time
    /Activity\s+(?:Period|Time)\s*:?[\s\S]*?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)[\s\S]*?(?:to|-)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)/i,
    // Event Period / Event Time
    /Event\s+(?:Period|Time)\s*:?[\s\S]*?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)[\s\S]*?(?:to|-)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)/i,
  ];

  let startUtc = null;
  let endUtc = null;

  for (const re of periodRegexes) {
    const m = html.match(re);
    if (m) {
      const [, sDate, sTime, eDate, eTime] = m;
      startUtc = dayjs
        .utc(`${sDate} ${sTime}`, "YYYY-MM-DD HH:mm", true)
        .toISOString();
      endUtc = dayjs
        .utc(`${eDate} ${eTime}`, "YYYY-MM-DD HH:mm", true)
        .toISOString();
      break;
    }
  }

  const rawText = stripTags(html);
  let description = rawText;

  const startIdx = rawText.toLowerCase().indexOf("fellow binancians");
  const endIdx = rawText.toLowerCase().indexOf("terms");

  if (startIdx !== -1) {
    description = rawText.slice(
      startIdx,
      endIdx !== -1 ? endIdx : startIdx + 2000
    );
  }

  description = description.trim();
  if (description.length > 4000) description = description.slice(0, 4000);

  return { title, officialLink, startUtc, endUtc, description };
}

/**
 * =========================
 * Binance Tournaments: розбір кількох турнірних періодів зі сторінки анонсу
 * =========================
 */

// "588,000" / "2,450" / "240" -> 588000 / 2450 / 240
function parseNumber(str) {
  if (str == null) return null;
  const normalized = String(str).replace(/[\s,]/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

// MEXC лінк на ціну (формат, який автоматично розпізнає форма сайту)
function buildMexcPriceLink(ticker) {
  if (!ticker) return null;
  const symbol = String(ticker).trim().toUpperCase();
  if (!symbol) return null;
  return `https://www.mexc.com/uk-UA/futures/${symbol}_USDT?lang=uk-UA&_from=search`;
}

/**
 * Дістаємо тикер монети із заголовка анонсу.
 * Приклад: "...Trade Zest Protocol (ZEST) and Share $200K..." -> ZEST
 */
function extractTickerFromTitle(title) {
  if (!title) return null;
  const matches = [...title.matchAll(/\(([A-Z0-9]{2,15})\)/g)];
  // беремо останній валідний тикер у дужках (ігноруючи дати на кшталт (2026-05-26))
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const candidate = matches[i][1];
    if (/^[A-Z][A-Z0-9]*$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Парсимо нагороди турніру:
 * "The top 2,450 users ... will share 588,000 ZEST tokens equally (= 240 ZEST per user)."
 */
export function parseTournamentRewards(text) {
  const topMatch = text.match(/top\s+([\d,]+)\s+users/i);
  const poolMatch = text.match(
    /share\s+([\d,]+)\s+([A-Z0-9]{2,15})\s+tokens?/i
  );
  const perUserMatch = text.match(
    /\(\s*=\s*([\d,.]+)\s+([A-Z0-9]{2,15})\s+per\s+user\s*\)/i
  );

  const topRaw = topMatch ? topMatch[1] : null;
  const poolRaw = poolMatch ? poolMatch[1] : null;
  const perUserRaw = perUserMatch ? perUserMatch[1] : null;

  const ticker =
    (perUserMatch && perUserMatch[2]) ||
    (poolMatch && poolMatch[2]) ||
    null;

  return {
    topRaw, // "2,450" (для опису)
    poolRaw, // "588,000" (для опису)
    perUserRaw, // "240"
    poolNum: parseNumber(poolRaw),
    perUserNum: parseNumber(perUserRaw),
    ticker: ticker ? ticker.toUpperCase() : null,
  };
}

/**
 * Парсимо кілька турнірних періодів (1st / 2nd / ...).
 * Беремо тільки рядки виду:
 * "1st ZEST Trading Competition Promotion Period: 2026-05-26 13:00 (UTC) to 2026-06-02 13:00 (UTC)"
 * Рядки таблиці множників (без "(UTC)" біля кожної дати) НЕ матчаться.
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

    periods.push({
      ordinal, // "1st"
      ticker: ticker.toUpperCase(), // "ZEST"
      startUtc,
      endUtc,
    });
  }
  return periods;
}

/**
 * На основі анонсу будуємо 1+ подій (по одній на кожен турнірний період).
 * Кожна подія готова для вставки в auto_events_pending.
 */
export function buildTournamentEvents({ html, title, officialLink }) {
  const text = stripTags(html);
  const periods = parseTournamentPeriods(text);
  if (!periods.length) return [];

  const rewards = parseTournamentRewards(text);
  const titleTicker = extractTickerFromTitle(title);

  return periods.map((period) => {
    const ticker = rewards.ticker || period.ticker || titleTicker;

    // Початок = очікувана роздача = дата завершення турніру + 2 дні, час 06:00 (Київ)
    const endKyiv = period.endUtc.tz(KYIV_TZ);
    const startKyiv = endKyiv
      .add(2, "day")
      .hour(6)
      .minute(0)
      .second(0)
      .millisecond(0);

    const eventTitle = `Нагорода за турнір ${period.ordinal} ${ticker}`;

    // Опис за шаблоном з документа
    const topPart = rewards.topRaw ? `Топ ${rewards.topRaw} ` : "";
    const poolPart = rewards.poolRaw ? `${rewards.poolRaw} ${ticker}` : "";
    const perUserPart = rewards.perUserRaw
      ? ` (= ${rewards.perUserRaw} ${ticker} на користувача)`
      : "";
    const rewardLine =
      topPart || poolPart
        ? `${topPart}розділять порівну ${poolPart}${perUserPart}.`
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

    // Дві монети: №1 — нагорода на користувача, №2 — фонд у тисячах
    const coins = [];
    if (rewards.perUserNum != null) {
      coins.push({ name: ticker, quantity: rewards.perUserNum });
    }
    if (rewards.poolNum != null) {
      coins.push({ name: ticker, quantity: rewards.poolNum / 1000 });
    }

    return {
      title: eventTitle,
      description: description || null,
      start_at: startKyiv.toISOString(),
      end_at: null,
      timezone: "Kyiv",
      type: "Binance Tournaments",
      event_type_slug: "binance_tournament",
      link: officialLink,
      coin_name: ticker || null,
      coin_quantity: rewards.perUserNum,
      coin_price_link: buildMexcPriceLink(ticker),
      tge_exchanges: [],
      coins: coins.length ? JSON.stringify(coins) : null,
    };
  });
}

/**
 * Дедуп: title + start_at + link
 */
async function insertIfMissing(supabase, payload) {
  const { data, error } = await supabase
    .from("auto_events_pending")
    .select("id")
    .eq("title", payload.title)
    .eq("start_at", payload.start_at)
    .eq("link", payload.link)
    .limit(1);

  if (error) throw error;
  if (data && data.length) return false;

  const { error: insErr } = await supabase.from("auto_events_pending").insert(payload);
  if (insErr) throw insErr;

  return true;
}

export default async function handler(req, res) {
  try {
    // auth
    const secret = req?.query?.secret;
    if (!process.env.BINANCE_SYNC_SECRET || secret !== process.env.BINANCE_SYNC_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const debug = req?.query?.debug === "1";
    const _debugRows = [];

    // supabase env
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing env: SUPABASE_URL(or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 1) fetch composite to get catalogId
    const compositeUrl = process.env.BINANCE_COMPOSITE_URL || DEFAULT_COMPOSITE_URL;
    const compositeText = await fetchText(compositeUrl);
    const compositeJson = safeJson(compositeText);

    if (!compositeJson) {
      return res.status(500).json({ ok: false, error: "Binance composite JSON parse failed" });
    }

    const catalogId = getCatalogIdFromComposite(compositeJson);

    if (debug) {
      const catalogs =
        compositeJson?.data?.catalogs?.map((c) => ({
          name: c?.catalogName,
          id: c?.catalogId,
          count: c?.articles?.length ?? null,
        })) || [];

      return res.status(200).json({
        ok: true,
        debug: true,
        catalogs,
        targetCatalog: TARGET_CATALOG_NAME,
        foundCatalogId: catalogId,
      });
    }

    if (!catalogId) {
      return res.status(500).json({
        ok: false,
        error: `Catalog "${TARGET_CATALOG_NAME}" not found in Binance response`,
      });
    }

    // 2) fetch only Latest Activities catalog articles
    const listUrl =
      process.env.BINANCE_LATEST_URL ||
      `${CATALOG_LIST_URL}?catalogId=${catalogId}&pageNo=1&pageSize=50`;

    const catalogText = await fetchText(listUrl);
    const catalogJson = safeJson(catalogText);
    if (!catalogJson) {
      return res.status(500).json({ ok: false, error: "Binance catalog JSON parse failed" });
    }

    const items = parseCatalogArticles(catalogJson);

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    // обмежимо щоб не впиратись у ліміти серверлеса
    const max = Number(process.env.BINANCE_MAX_ITEMS || "25");
    const slice = items.slice(0, max);

    for (const item of slice) {
      // keyword filter
      if (item.title && !looksLikeTournament(item.title)) {
        skipped += 1;
        continue;
      }

      processed += 1;

      const officialUrl = `https://www.binance.com/en/support/announcement/${item.code}`;

      let pageHtml = "";
      try {
        pageHtml = await fetchText(officialUrl);
      } catch {
        skipped += 1;
        continue;
      }

      const parsed = parseAnnouncementPage(pageHtml);
      const officialLink = parsed.officialLink || officialUrl;

      // ✅ Основний шлях: 1 анонс -> кілька подій (по турнірному періоду 1st/2nd/...)
      const tournamentEvents = buildTournamentEvents({
        html: pageHtml,
        title: parsed.title,
        officialLink,
      });

      if (tournamentEvents.length) {
        for (const payload of tournamentEvents) {
          const ok = await insertIfMissing(supabase, payload);
          if (ok) inserted += 1;
          else skipped += 1;
        }
        continue;
      }

      // Fallback: якщо періоди не розпізнались — стара логіка (1 подія, поля вручну)
      if (!parsed.title) {
        skipped += 1;
        continue;
      }

      // твоя логіка: кінець промо = start_at
      const start_at = parsed.endUtc || parsed.startUtc;
      if (!start_at) {
        skipped += 1;
        continue;
      }

      const payload = {
        title: parsed.title,
        description: parsed.description || null,
        start_at,
        end_at: null,
        timezone: "Kyiv",
        type: "Binance Tournaments",
        event_type_slug: "binance_tournament",
        link: officialLink,

        // вручну заповниш
        coin_name: null,
        coin_quantity: null,
        coin_price_link: null,
        tge_exchanges: [],
        coins: null,
      };

      const ok = await insertIfMissing(supabase, payload);
      if (ok) inserted += 1;
      else skipped += 1;
    }

    return res.status(200).json({
      ok: true,
      processed,
      inserted,
      skipped,
      source: listUrl,
      // показуємо тільки якщо debug=1, інакше undefined
      debugRows: req?.query?.debug === "1" ? _debugRows : undefined,
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
