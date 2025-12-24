/* eslint-env node */
/* global process */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);
dayjs.extend(timezone);

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
        link: parsed.officialLink || officialUrl,

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
