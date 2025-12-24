/* eslint-env node */
/* global process */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);
dayjs.extend(timezone);

// ✅ Binance CMS list (JSON)
const DEFAULT_LIST_URL =
  "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=50";

// ✅ беремо тільки цей каталог
const TARGET_CATALOG = "latest activities";

// ✅ ключові слова для “турнірів”
const TITLE_KEYWORDS = [
  "Trading Competition",
  // "Competition",
  // "Tournament",
  // "Deposit Campaign",
  // "Campaign",
];

// -----------------------------
// Helpers
// -----------------------------
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

// -----------------------------
// 1) Parse Binance CMS list JSON
// -----------------------------
function parseLatestList(jsonText) {
  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const catalogs = obj?.data?.catalogs || [];
  const latest = catalogs.find(
    (c) => (c?.catalogName || "").trim().toLowerCase() === TARGET_CATALOG
  );
  if (!latest) return [];

  const articles = latest.articles || [];
  return articles
    .map((a) => ({
      code: a.code,
      title: a.title,
      releaseDate: a.releaseDate,
    }))
    .filter((a) => a.code && a.title);
}

// -----------------------------
// 2) Parse announcement page HTML
// -----------------------------
function parseAnnouncementPage(html) {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1Match ? stripTags(h1Match[1]) : null;

  const officialMatch = html.match(/href="(https:\/\/www\.binance\.com[^"]+)"/i);
  const officialLink = officialMatch ? officialMatch[1] : null;

  // ✅ підтримуємо кілька варіантів написання періоду
  const periodRegexes = [
    // Promotion Period: ... (UTC) to ... (UTC)
    /Promotion\s+(?:Period|Time)\s*:?[\s\S]*?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)[\s\S]*?(?:to|-)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)/i,
    // Activity Period: ... (UTC) to ... (UTC)
    /Activity\s+(?:Period|Time)\s*:?[\s\S]*?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)[\s\S]*?(?:to|-)\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)/i,
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

  // Description: вирізаємо найбільш “читабельний” шматок
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

// -----------------------------
// 3) Insert if missing (simple dedupe)
// -----------------------------
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

// -----------------------------
// Vercel handler
// -----------------------------
export default async function handler(req, res) {
  try {
    // ✅ захист через secret у query
    const secret = req?.query?.secret;
    if (
      !process.env.BINANCE_SYNC_SECRET ||
      secret !== process.env.BINANCE_SYNC_SECRET
    ) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const debug = req?.query?.debug === "1";

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing env: SUPABASE_URL(or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const listUrl = process.env.BINANCE_LATEST_URL || DEFAULT_LIST_URL;

    // ✅ Для debug: показуємо які каталоги прийшли (без “випливання” великих даних)
    const listText = await fetchText(listUrl);

    if (debug) {
      let parsed;
      try {
        parsed = JSON.parse(listText);
      } catch {
        parsed = null;
      }

      const names =
        parsed?.data?.catalogs?.map((c) => c?.catalogName).filter(Boolean) || [];

      return res.status(200).json({
        ok: true,
        debug: true,
        listUrl,
        catalogs: names,
        note: `Target catalog = "${TARGET_CATALOG}"`,
      });
    }

    const items = parseLatestList(listText);

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    for (const item of items) {
      // 1) keyword filter по title зі списку
      if (item.title && !looksLikeTournament(item.title)) {
        skipped += 1;
        continue;
      }

      processed += 1;

      // 2) офіційна сторінка
      const officialUrl = `https://www.binance.com/en/support/announcement/${item.code}`;
      const pageHtml = await fetchText(officialUrl);

      const parsed = parseAnnouncementPage(pageHtml);

      if (!parsed.title) {
        skipped += 1;
        continue;
      }

      // 3) твоя логіка: кінець промо = start_at
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

        // вручну заповниш:
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
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
