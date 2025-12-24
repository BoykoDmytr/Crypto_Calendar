/* eslint-env node */
/* global process */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { createClient } from "@supabase/supabase-js";

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_LIST_URL = "https://cache.bwe-ws.com/bn-latest";
const ALLOWED_CATEGORIES = new Set(["Latest Activities"]);
const TITLE_KEYWORDS = [
  "Trading Competition",
  //"Competition",
  //"Tournament",
  //"Deposit Campaign",
  //"Campaign",
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
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

/**
 * bn-latest — простий HTML список.
 * Ми дістаємо title + category і поруч шукаємо URL виду https://cache.bwe-ws.com/bn-726
 */
function parseLatestList(html) {
  const urls = new Set();

  // 1) абсолютні урли
  for (const m of html.matchAll(/https:\/\/cache\.bwe-ws\.com\/bn-\d+/g)) {
    urls.add(m[0]);
  }

  // 2) відносні href="/bn-123"
  for (const m of html.matchAll(/href="(\/bn-\d+)"/g)) {
    urls.add(`https://cache.bwe-ws.com${m[1]}`);
  }

  // 3) просто "/bn-123" у тексті
  for (const m of html.matchAll(/\/bn-\d+/g)) {
    urls.add(`https://cache.bwe-ws.com${m[0]}`);
  }

  return Array.from(urls).slice(0, 60).map((url) => ({ url }));
}


/**
 * На сторінці bn-### є:
 *  - <h1> Title
 *  - Promotion Period: YYYY-MM-DD HH:mm (UTC) to YYYY-MM-DD HH:mm (UTC)
 */
function parseAnnouncementPage(html) {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1Match ? stripTags(h1Match[1]) : null;

  const officialMatch = html.match(/href="(https:\/\/www\.binance\.com[^"]+)"/i);
  const officialLink = officialMatch ? officialMatch[1] : null;

  const promoRe =
    /Promotion Period:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)\s*to\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*([0-9]{2}:[0-9]{2})\s*\(UTC\)/i;

  const promo = html.match(promoRe);
  let startUtc = null;
  let endUtc = null;

  if (promo) {
    const [, sDate, sTime, eDate, eTime] = promo;
    startUtc = dayjs
      .utc(`${sDate} ${sTime}`, "YYYY-MM-DD HH:mm", true)
      .toISOString();
    endUtc = dayjs
      .utc(`${eDate} ${eTime}`, "YYYY-MM-DD HH:mm", true)
      .toISOString();
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
    // === Дуже простий захист через secret у query ===
    // cron буде ходити на /api/sync/binance?secret=...
    const secret = req?.query?.secret;
    if (!process.env.BINANCE_SYNC_SECRET || secret !== process.env.BINANCE_SYNC_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

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

    const listUrl = process.env.BINANCE_LATEST_URL || DEFAULT_LIST_URL;
    const listHtml = await fetchText(listUrl);
    const debug = req?.query?.debug === "1";
    if (debug) {
      const sample = listHtml.slice(0, 1200);

      const abs = [...listHtml.matchAll(/https:\/\/cache\.bwe-ws\.com\/bn-\d+/g)].map(m => m[0]);
      const hrefRel = [...listHtml.matchAll(/href="(\/bn-\d+)"/g)].map(m => `https://cache.bwe-ws.com${m[1]}`);
      const rel = [...listHtml.matchAll(/\/bn-\d+/g)].map(m => `https://cache.bwe-ws.com${m[0]}`);

      const urls = Array.from(new Set([...abs, ...hrefRel, ...rel])).slice(0, 20);

      return res.status(200).json({
        ok: true,
        debug: true,
        listUrl,
        htmlStartsWith: sample,
        found: {
          abs: abs.length,
          hrefRel: hrefRel.length,
          rel: rel.length,
          uniqueFirst20: urls
        }
      });
    }

    const items = parseLatestList(listHtml);

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    for (const item of items) {
      processed += 1;

      const pageHtml = await fetchText(item.url);

      // (опційно) залишаємо тільки Latest Activities по сторінці
      if (!/Latest Activities/i.test(pageHtml)) continue;

      const parsed = parseAnnouncementPage(pageHtml);

      if (!parsed.title) { skipped += 1; continue; }

      // ✅ ОТУТ ФІЛЬТР ПО КЛЮЧОВИХ СЛОВАХ — ПО РЕАЛЬНОМУ TITLE
      if (!looksLikeTournament(parsed.title)) continue;

      const start_at = parsed.endUtc || parsed.startUtc;
      if (!start_at) { skipped += 1; continue; }

      const payload = {
        title: parsed.title,
        description: parsed.description || null,
        start_at,
        end_at: null,
        timezone: "Kyiv",
        type: "Binance Tournaments",
        event_type_slug: "binance_tournament",
        link: parsed.officialLink || item.url,

        // ці поля будеш руками:
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

    return res.status(200).json({ ok: true, processed, inserted, skipped, source: listUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
