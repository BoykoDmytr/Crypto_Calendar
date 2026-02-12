// @ts-nocheck
// Updated cron function to capture ±30m reaction data and event size metrics.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import dayjs from "npm:dayjs@1.11.10";
import utc from "npm:dayjs@1.11.10/plugin/utc.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

dayjs.extend(utc);

// How far ahead to scan for upcoming events (days)
const LOOKAHEAD_DAYS = 60;
// After T0+35 minutes we can safely fetch ±30m series
const SERIES_CUTOFF_MINUTES = 35;
// Price capture window in minutes for T0, +5, +15
const CAPTURE_WINDOW_MINUTES = 10;

function normalizeValidPrice(value: number | string | null): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Normalize spot symbol (BREV_USDT -> BREVUSDT)
function normalizeMexcSpotSymbol(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 5) return null;
  return cleaned;
}

// Normalize futures symbol (BREV_USDT stays BREV_USDT)
function normalizeMexcFuturesSymbol(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9_]/g, "");
  if (!/_USDT$/.test(cleaned)) return null;
  if (cleaned.length < 6) return null;
  return cleaned;
}

function isMexcFuturesLink(link: string | null): boolean {
  if (!link) return false;
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    if (host.startsWith("futures.") || host.startsWith("contract.")) return true;
    if (host.includes("futures") || host.includes("contract")) return true;
    const path = url.pathname.toLowerCase();
    if (path.includes("/futures/") || path.includes("/contract/") || path.includes("/swap/")) return true;
    const type = url.searchParams.get("type");
    if (type && type.toLowerCase() === "linear_swap") return true;
  } catch {
    // ignore
  }
  return /\/futures\//i.test(link) || /type=linear_swap/i.test(link);
}

function parseMexcLink(link: string | null) {
  if (!link) return null;
  const s = link.trim();
  const futures = isMexcFuturesLink(s);
  const m = s.match(/\/(futures|exchange)\/([A-Z0-9]{1,}_USDT)/i) || s.match(/([A-Z0-9]{1,}_USDT)/i);
  const pair = m ? m[m.length - 1].toUpperCase() : null;
  if (!pair) return null;
  const market = futures ? "futures" : "spot";
  return {
    pair,
    apiPair: market === "futures" ? normalizeMexcFuturesSymbol(pair) : normalizeMexcSpotSymbol(pair),
    market,
  };
}

function pickMexcMarket(ev: any) {
  // 1) from coin_price_link
  const fromLink = parseMexcLink(ev.coin_price_link);
  if (fromLink) {
    return {
      pair: fromLink.pair,
      apiPair: fromLink.apiPair,
      market: fromLink.market,
    };
  }
  // 2) from coin_name (e.g. BREV -> BREV_USDT)
  if (ev.coin_name) {
    const sym = String(ev.coin_name).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (sym) {
      const pair = `${sym}_USDT`;
      return {
        pair,
        apiPair: normalizeMexcSpotSymbol(pair),
        market: "spot",
      };
    }
  }
  // 3) from tge_exchanges list
  const exchanges = Array.isArray(ev.tge_exchanges) ? ev.tge_exchanges : [];
  const entry = exchanges.find((x) => x?.pair && String(x.pair).toUpperCase().includes("USDT")) || exchanges[0];
  if (entry?.pair) {
    const pair = String(entry.pair).toUpperCase();
    const market = isMexcFuturesLink(ev.coin_price_link || ev.link || "") ? "futures" : "spot";
    return {
      pair,
      apiPair: market === "futures" ? normalizeMexcFuturesSymbol(pair) : normalizeMexcSpotSymbol(pair),
      market,
    };
  }
  return null;
}

function shouldCapture(nowUtc: dayjs.Dayjs, targetTimeUtc: dayjs.Dayjs, windowMinutes = CAPTURE_WINDOW_MINUTES) {
  const diffSec = nowUtc.diff(targetTimeUtc, "second");
  return diffSec >= 0 && diffSec <= windowMinutes * 60;
}

function calcPercent(basePrice: number | null, nextPrice: number | null) {
  if (basePrice == null || nextPrice == null) return null;
  const b = Number(basePrice);
  const n = Number(nextPrice);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b <= 0) return null;
  return ((n - b) / b) * 100;
}

async function fetchMexcTicker(apiPair: string): Promise<number | null> {
  try {
    const url = new URL("https://api.mexc.com/api/v3/ticker/price");
    url.searchParams.set("symbol", apiPair);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const p = Number(data?.price ?? data?.lastPrice);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

async function fetchMexcSeries(apiPair: string, startTs: number, endTs: number) {
  try {
    const url = new URL("https://api.mexc.com/api/v3/klines");
    url.searchParams.set("symbol", apiPair);
    url.searchParams.set("interval", "1m");
    url.searchParams.set("startTime", String(startTs));
    url.searchParams.set("endTime", String(endTs));
    const res = await fetch(url.toString());
    const candles = await res.json();
    return candles;
  } catch {
    return [];
  }
}

serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or service key" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const nowUtc = dayjs.utc();
  const windowStart = nowUtc.subtract(1, "day").toISOString();
  const windowEnd = nowUtc.add(LOOKAHEAD_DAYS, "day").toISOString();
  // 1) fetch types to track
  const { data: types, error: typesErr } = await supabase
    .from("event_types")
    .select("slug,name,label,track_in_stats,active")
    .eq("track_in_stats", true)
    .eq("active", true);
  if (typesErr) {
    return new Response(JSON.stringify({ ok: false, error: String(typesErr.message) }), { status: 500 });
  }
  const slugs = new Set<string>();
  const names = new Set<string>();
  (types ?? []).forEach((t: any) => {
    if (t.slug) slugs.add(t.slug);
    if (t.name) names.add(t.name);
    if (t.label) names.add(t.label);
  });
  if (slugs.size === 0 && names.size === 0) {
    ["binance_tournament", "ts_bybit", "booster"].forEach((s) => slugs.add(s));
    ["Binance Tournaments", "TS Bybit", "Booster"].forEach((n) => names.add(n));
  }
  // 2) fetch events in window
  const { data: events, error: eventsErr } = await supabase
    .from("events_approved")
    .select("id,title,start_at,type,event_type_slug,coin_name,tge_exchanges,coin_price_link,link,event_usd_value,mcap_usd")
    .gte("start_at", windowStart)
    .lte("start_at", windowEnd)
    .not("start_at", "is", null);
  if (eventsErr) {
    return new Response(JSON.stringify({ ok: false, error: String(eventsErr.message) }), { status: 500 });
  }
  const tracked = (events ?? []).filter((ev: any) => {
    const okSlug = ev.event_type_slug && slugs.has(ev.event_type_slug);
    const okType = ev.type && names.has(ev.type);
    return okSlug || okType;
  });
  const ids = tracked.map((e: any) => e.id);
  // fetch existing reaction rows
  const { data: existing, error: existingErr } = await supabase
    .from("event_price_reaction")
    .select("*")
    .in("event_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (existingErr) {
    return new Response(JSON.stringify({ ok: false, error: String(existingErr.message) }), { status: 500 });
  }
  const map = new Map<string, any>();
  (existing ?? []).forEach((r: any) => map.set(r.event_id, r));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  for (const ev of tracked) {
    try {
      const t0 = dayjs.utc(ev.start_at);
      const t5 = t0.add(5, "minute");
      const t15 = t0.add(15, "minute");
      const market = pickMexcMarket(ev);
      if (!market?.apiPair) {
        skipped++;
        continue;
      }
      const row = map.get(ev.id);
      // insert stub if not exists
      if (!row) {
        const payload: any = {
          event_id: ev.id,
          coin_name: ev.coin_name ?? null,
          pair: market.pair,
          exchange: market.market === "futures" ? "MEXC" : "MEXC",
          t0_time: t0.toISOString(),
          t0_price: null,
          t0_percent: 0,
          t_plus_5_time: t5.toISOString(),
          t_plus_5_price: null,
          t_plus_5_percent: null,
          t_plus_15_time: t15.toISOString(),
          t_plus_15_price: null,
          t_plus_15_percent: null,
          // new fields for ±30m
          series_close: null,
          series_high: null,
          series_low: null,
          pre_return_30m: null,
          post_return_30m: null,
          net_return_60m: null,
          max_price: null,
          max_offset: null,
          min_price: null,
          min_offset: null,
          event_pct_mcap: null,
        };
        const { error } = await supabase.from("event_price_reaction").insert(payload);
        if (error) throw error;
        inserted++;
        map.set(ev.id, payload);
        continue;
      }
      // update T0, +5, +15 if needed
      const patch: any = {};
      // capture T0
      if (row.t0_price == null && shouldCapture(nowUtc, t0)) {
        const p0 = await fetchMexcTicker(market.apiPair!);
        if (p0 != null) {
          patch.t0_price = p0;
          patch.t0_percent = 0;
        }
      }
      const base = patch.t0_price ?? row.t0_price;
      // capture +5
      if (row.t_plus_5_price == null && base != null && shouldCapture(nowUtc, t5)) {
        const p5 = await fetchMexcTicker(market.apiPair!);
        if (p5 != null) {
          patch.t_plus_5_price = p5;
          patch.t_plus_5_percent = calcPercent(base, p5);
        }
      }
      // capture +15
      if (row.t_plus_15_price == null && base != null && shouldCapture(nowUtc, t15)) {
        const p15 = await fetchMexcTicker(market.apiPair!);
        if (p15 != null) {
          patch.t_plus_15_price = p15;
          patch.t_plus_15_percent = calcPercent(base, p15);
        }
      }
      // update simple fields if any patch
      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from("event_price_reaction")
          .update(patch)
          .eq("event_id", ev.id);
        if (error) throw error;
        updated++;
      }
      // if series already computed, skip heavy fetch
      if (row.series_close && Array.isArray(row.series_close) && row.series_close.length === 61) {
        skipped++;
        continue;
      }
      // Wait until +35m after T0 to fetch ±30m series
      const cutoff = t0.add(SERIES_CUTOFF_MINUTES, "minute");
      if (nowUtc.isBefore(cutoff)) {
        skipped++;
        continue;
      }
      // Fetch 1m candles
      const startTs = t0.subtract(30, "minute").valueOf();
      const endTs = t0.add(30, "minute").valueOf();
      const candles = await fetchMexcSeries(market.apiPair!, startTs, endTs);
      const closeSeries: Array<number | null> = new Array(61).fill(null);
      const highSeries: Array<number | null> = new Array(61).fill(null);
      const lowSeries: Array<number | null> = new Array(61).fill(null);
      candles.forEach((c: any) => {
        const [ts, open, high, low, close] = c;
        const off = Math.round((ts - startTs) / 60000);
        if (off >= 0 && off < 61) {
          closeSeries[off] = Number(close);
          highSeries[off] = Number(high);
          lowSeries[off] = Number(low);
        }
      });
      const basePrice = closeSeries[30];
      const prePrice = closeSeries[0];
      const postPrice = closeSeries[60];
      const preReturn = prePrice != null && basePrice != null ? ((basePrice - prePrice) / prePrice) * 100 : null;
      const postReturn = basePrice != null && postPrice != null ? ((postPrice - basePrice) / basePrice) * 100 : null;
      const netReturn = prePrice != null && postPrice != null ? ((postPrice - prePrice) / prePrice) * 100 : null;
      // max/min index
      let maxIdx = 0;
      let minIdx = 0;
      for (let i = 0; i < 61; i++) {
        if (highSeries[i] != null && (highSeries[maxIdx] == null || highSeries[i]! > highSeries[maxIdx]!)) {
          maxIdx = i;
        }
        if (lowSeries[i] != null && (lowSeries[minIdx] == null || lowSeries[i]! < lowSeries[minIdx]!)) {
          minIdx = i;
        }
      }
      const maxPrice = highSeries[maxIdx] ?? null;
      const minPrice = lowSeries[minIdx] ?? null;
      const maxOffset = maxIdx - 30;
      const minOffset = minIdx - 30;
      // compute event_pct_mcap
      let eventPctMcap: number | null = null;
      if (ev.event_usd_value && ev.mcap_usd && Number(ev.mcap_usd) > 0) {
        eventPctMcap = (Number(ev.event_usd_value) / Number(ev.mcap_usd)) * 100;
      }
      const update = {
        series_close: closeSeries,
        series_high: highSeries,
        series_low: lowSeries,
        pre_return_30m: preReturn,
        post_return_30m: postReturn,
        net_return_60m: netReturn,
        max_price: maxPrice,
        max_offset: maxOffset,
        min_price: minPrice,
        min_offset: minOffset,
        event_pct_mcap: eventPctMcap,
      };
      const { error: updErr } = await supabase
        .from("event_price_reaction")
        .update(update)
        .eq("event_id", ev.id);
      if (updErr) throw updErr;
      updated++;
    } catch (e) {
      console.error("cron error for event", ev?.id, e);
      errors++;
    }
  }
  return new Response(
    JSON.stringify({ ok: true, processed: tracked.length, inserted, updated, skipped, errors }),
    { headers: { "content-type": "application/json" } },
  );
});