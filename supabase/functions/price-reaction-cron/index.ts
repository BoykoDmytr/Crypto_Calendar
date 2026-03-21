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

// In the series we ALWAYS include T0..T+30 (31 points)
const AFTER_EVENT_POINTS = 31;

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
  const m =
    s.match(/\/(futures|exchange)\/([A-Z0-9]{1,}_USDT)/i) ||
    s.match(/([A-Z0-9]{1,}_USDT)/i);

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
  const entry =
    exchanges.find((x) => x?.pair && String(x.pair).toUpperCase().includes("USDT")) || exchanges[0];

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

function shouldCapture(
  nowUtc: dayjs.Dayjs,
  targetTimeUtc: dayjs.Dayjs,
  windowMinutes = CAPTURE_WINDOW_MINUTES,
) {
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

// ✅ Spot + Futures ticker
async function fetchMexcTicker(market: { apiPair: string; market: "spot" | "futures" }): Promise<number | null> {
  try {
    if (market.market === "futures") {
      // Contract ticker: https://contract.mexc.com/api/v1/contract/ticker?symbol=BTC_USDT :contentReference[oaicite:2]{index=2}
      const url = new URL("https://contract.mexc.com/api/v1/contract/ticker");
      url.searchParams.set("symbol", market.apiPair);
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const json = await res.json();
      const p = Number(json?.data?.lastPrice ?? json?.data?.fairPrice ?? json?.data?.indexPrice);
      return Number.isFinite(p) ? p : null;
    }

    // Spot ticker: https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT
    const url = new URL("https://api.mexc.com/api/v3/ticker/price");
    url.searchParams.set("symbol", market.apiPair);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const p = Number(data?.price ?? data?.lastPrice);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

// ✅ Spot + Futures klines -> normalized candles: [tsMs, open, high, low, close]
async function fetchMexcSeries(
  market: { apiPair: string; market: "spot" | "futures" },
  startTsMs: number,
  endTsMs: number,
): Promise<any[]> {
  try {
    if (market.market === "futures") {
      // Contract kline endpoint uses SECONDS and returns object arrays :contentReference[oaicite:3]{index=3}
      const startSec = Math.floor(startTsMs / 1000);
      const endSec = Math.floor(endTsMs / 1000);

      const url = new URL(`https://contract.mexc.com/api/v1/contract/kline/${market.apiPair}`);
      url.searchParams.set("interval", "Min1");
      url.searchParams.set("start", String(startSec));
      url.searchParams.set("end", String(endSec));

      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const json = await res.json();

      if (!json?.success || !json?.data?.time) return [];

      const t = json.data.time || [];
      const o = json.data.open || [];
      const h = json.data.high || [];
      const l = json.data.low || [];
      const c = json.data.close || [];

      return t.map((sec: any, i: number) => [
        Number(sec) * 1000,
        o[i],
        h[i],
        l[i],
        c[i],
      ]);
    }

    // Spot klines uses MILLISECONDS and returns array-of-arrays :contentReference[oaicite:4]{index=4}
    const url = new URL("https://api.mexc.com/api/v3/klines");
    url.searchParams.set("symbol", market.apiPair);
    url.searchParams.set("interval", "1m");
    url.searchParams.set("startTime", String(startTsMs));
    url.searchParams.set("endTime", String(endTsMs));
    url.searchParams.set("limit", "1000");
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const candles = await res.json();
    if (!Array.isArray(candles)) return [];

    // Normalize to [tsMs, open, high, low, close]
    return candles.map((c: any) => [Number(c[0]), c[1], c[2], c[3], c[4]]);
  } catch {
    return [];
  }
}

// ✅ series is "ready" only if it has at least one non-null price
function hasAnySeriesValue(series: any): boolean {
  return Array.isArray(series) && series.some((v) => v != null);
}

// ✅ pick listing time:
// 1) prefer MEXC listing from tge_exchanges (if entry contains "mexc")
// 2) else earliest listing time among all entries
function pickListingMinute(ev: any): dayjs.Dayjs | null {
  const exchanges = Array.isArray(ev.tge_exchanges) ? ev.tge_exchanges : [];
  let mexc: dayjs.Dayjs | null = null;
  let earliest: dayjs.Dayjs | null = null;

  for (const ex of exchanges) {
    const t = ex?.time;
    if (!t) continue;

    const dt = dayjs.utc(t).startOf("minute");

    // earliest among all
    if (!earliest || dt.isBefore(earliest)) earliest = dt;

    const label = String(ex?.exchange ?? ex?.name ?? ex?.title ?? ex?.platform ?? "").toLowerCase();
    if (label.includes("mexc")) {
      if (!mexc || dt.isBefore(mexc)) mexc = dt;
    }
  }

  return mexc || earliest;
}

serve(async (_req: Request) => {
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

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
  .select(
    "id,title,start_at,type,event_type_slug,coin_name,tge_exchanges,coin_price_link,link,event_usd_value,mcap_usd,created_at,coin_quantity,coin_circ_supply"
  )
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

      let row = map.get(ev.id);

      // ✅ If event start time changed (before series is built) => reset reaction row
      if (row) {
        const hasSeries = hasAnySeriesValue(row.series_close);

        const dbT0 = dayjs.utc(row.t0_time).startOf("minute").toISOString();
        const evT0 = t0.startOf("minute").toISOString();

        if (dbT0 !== evT0 && !hasSeries) {
          const resetPatch: any = {
            // update times
            t0_time: t0.toISOString(),
            t_plus_5_time: t5.toISOString(),
            t_plus_15_time: t15.toISOString(),

            // (optional but good) keep meta in sync
            coin_name: ev.coin_name ?? null,
            pair: market.pair,
            exchange: "MEXC",

            // reset prices
            t0_price: null,
            t0_percent: 0,
            t_plus_5_price: null,
            t_plus_5_percent: null,
            t_plus_15_price: null,
            t_plus_15_percent: null,

            // reset series + KPIs
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

          const { error: resetErr } = await supabase
            .from("event_price_reaction")
            .update(resetPatch)
            .eq("event_id", ev.id);

          if (resetErr) {
            errors++;
            continue;
          }

          row = { ...row, ...resetPatch };
          map.set(ev.id, row);
          updated++;
        }
      }

      // insert stub if not exists
      if (!row) {
        const payload: any = {
          event_id: ev.id,
          coin_name: ev.coin_name ?? null,
          pair: market.pair,
          exchange: "MEXC",

          t0_time: t0.toISOString(),
          t0_price: null,
          t0_percent: 0,

          t_plus_5_time: t5.toISOString(),
          t_plus_5_price: null,
          t_plus_5_percent: null,

          t_plus_15_time: t15.toISOString(),
          t_plus_15_price: null,
          t_plus_15_percent: null,

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

      if (row.t0_price == null && shouldCapture(nowUtc, t0)) {
        const p0 = await fetchMexcTicker({ apiPair: market.apiPair!, market: market.market });
        if (p0 != null) {
          patch.t0_price = p0;
          patch.t0_percent = 0;
          // встановлюємо price_snap, якщо його ще немає
         if (row.price_snap == null) {
           patch.price_snap = p0;
         }
        }
      }

      const base = patch.t0_price ?? row.t0_price;

      if (row.t_plus_5_price == null && base != null && shouldCapture(nowUtc, t5)) {
        const p5 = await fetchMexcTicker({ apiPair: market.apiPair!, market: market.market });
        if (p5 != null) {
          patch.t_plus_5_price = p5;
          patch.t_plus_5_percent = calcPercent(base, p5);
        }
      }

      if (row.t_plus_15_price == null && base != null && shouldCapture(nowUtc, t15)) {
        const p15 = await fetchMexcTicker({ apiPair: market.apiPair!, market: market.market });
        if (p15 != null) {
          patch.t_plus_15_price = p15;
          patch.t_plus_15_percent = calcPercent(base, p15);
        }
      }

      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from("event_price_reaction")
          .update(patch)
          .eq("event_id", ev.id);

        if (error) throw error;
        updated++;
      }

            // --------------------------------------------------------------------
      // Take snapshot of event value and MCAP if missing on the event itself.
      // Compute from the T0 price, coin quantity and circulating supply. If
      // either event_usd_value or mcap_usd is NULL, calculate them and update
      // the events_approved table. This guarantees that event_pct_mcap will
      // be available for all events, not just those created by telegram.
      // --------------------------------------------------------------------
      if (ev.event_usd_value == null || ev.mcap_usd == null) {
        // Use the fresh T0 price if captured; otherwise fallback to DB value or fetch a new price
        let price = patch.t0_price ?? row.t0_price ?? null;
        if (price == null) {
          price = await fetchMexcTicker({ apiPair: market.apiPair!, market: market.market });
        }
        const qty = Number(ev.coin_quantity);
        const circ = Number(ev.coin_circ_supply);
        let eventUsd: number | null = null;
        let mcapUsd: number | null = null;
        if (price != null && Number.isFinite(price)) {
          if (Number.isFinite(qty) && qty > 0) {
            eventUsd = price * qty;
          }
          // If we have a circulating supply stored, compute MCAP directly.
          if (Number.isFinite(circ) && circ > 0) {
            mcapUsd = price * circ;
          }
        }
        // If we still lack MCAP but have a coin name, call the dropstab-circ
        // edge function to fetch circulating supply dynamically.
        if (mcapUsd == null && price != null && ev.coin_name) {
          try {
            const { data: circRes, error: circErr } = await supabase.functions.invoke(
              "dropstab-circ",
              { body: { symbol: String(ev.coin_name).toUpperCase() } },
            );
            if (!circErr) {
              const circSupply = Number(circRes?.data?.circulating_supply);
              if (Number.isFinite(circSupply) && circSupply > 0) {
                mcapUsd = price * circSupply;
              }
            }
          } catch {}
        }
        // If we computed at least one of the values, persist them in events_approved.
        if (eventUsd != null || mcapUsd != null) {
          const updatePayload: any = {};
          if (eventUsd != null) updatePayload.event_usd_value = eventUsd;
          if (mcapUsd != null) updatePayload.mcap_usd = mcapUsd;
          const { error: updEventErr } = await supabase
            .from("events_approved")
            .update(updatePayload)
            .eq("id", ev.id);
          if (!updEventErr) {
            // Update local copy so that event_pct_mcap calculation uses these values
            if (eventUsd != null) ev.event_usd_value = eventUsd;
            if (mcapUsd != null) ev.mcap_usd = mcapUsd;
          }
        }
      }

      // ✅ if series already computed with at least one real value, skip heavy fetch
      if (hasAnySeriesValue(row.series_close)) {
        skipped++;
        continue;
      }

      // Wait until +35m after T0 to fetch series
      const cutoff = t0.add(SERIES_CUTOFF_MINUTES, "minute");
      if (nowUtc.isBefore(cutoff)) {
        skipped++;
        continue;
      }

      // ✅ T0 minute rule
      const t0Minute = t0.startOf("minute");

      // anchor = max(created_at, listing_time)
      const createdMinute = ev.created_at ? dayjs.utc(ev.created_at).startOf("minute") : null;
      const listingMinute = pickListingMinute(ev);

      let anchorMinute: any = null;
      if (createdMinute && listingMinute) {
        anchorMinute = createdMinute.isAfter(listingMinute) ? createdMinute : listingMinute;
      } else {
        anchorMinute = createdMinute || listingMinute || null;
      }

      // default start = t0-30m
      let startMinute = t0Minute.subtract(30, "minute");

      // move start forward if anchor is later
      if (anchorMinute && anchorMinute.isAfter(startMinute)) {
        startMinute = anchorMinute;
      }

      // never start AFTER T0 (avoid negative preDuration)
      if (startMinute.isAfter(t0Minute)) {
        startMinute = t0Minute;
      }

      const startTs = startMinute.valueOf();
      const endTs = t0Minute.add(31, "minute").valueOf(); // include +30 candle

      const candles = await fetchMexcSeries(
        { apiPair: market.apiPair!, market: market.market },
        startTs,
        endTs,
      );

      const preDuration = t0Minute.diff(startMinute, "minute");
      const totalPoints = preDuration + AFTER_EVENT_POINTS;

      const closeSeries: Array<number | null> = new Array(totalPoints).fill(null);
      const highSeries: Array<number | null> = new Array(totalPoints).fill(null);
      const lowSeries: Array<number | null> = new Array(totalPoints).fill(null);

      for (const c of candles || []) {
        // normalized: [tsMs, open, high, low, close]
        const [tsMs, _open, high, low, close] = c;

        const off = Math.floor((Number(tsMs) - startTs) / 60000);
        if (off >= 0 && off < totalPoints) {
          closeSeries[off] = normalizeValidPrice(close);
          highSeries[off] = normalizeValidPrice(high);
          lowSeries[off] = normalizeValidPrice(low);
        }
      }

      const baseIndex = preDuration;
      const basePrice = closeSeries[baseIndex];
      const prePrice = closeSeries[0];
      const postPrice = closeSeries[totalPoints - 1];

      const preReturn =
        prePrice != null && basePrice != null && Number(prePrice) > 0
          ? ((basePrice - prePrice) / prePrice) * 100
          : null;

      const postReturn =
        basePrice != null && postPrice != null && Number(basePrice) > 0
          ? ((postPrice - basePrice) / basePrice) * 100
          : null;

      const netReturn =
        prePrice != null && postPrice != null && Number(prePrice) > 0
          ? ((postPrice - prePrice) / prePrice) * 100
          : null;

      // max/min index
      let maxIdx = 0;
      let minIdx = 0;
      for (let i = 0; i < totalPoints; i++) {
        if (
          highSeries[i] != null &&
          (highSeries[maxIdx] == null || (highSeries[i] as number) > (highSeries[maxIdx] as number))
        ) {
          maxIdx = i;
        }
        if (
          lowSeries[i] != null &&
          (lowSeries[minIdx] == null || (lowSeries[i] as number) < (lowSeries[minIdx] as number))
        ) {
          minIdx = i;
        }
      }

      const maxPrice = highSeries[maxIdx] ?? null;
      const minPrice = lowSeries[minIdx] ?? null;
      const maxOffset = maxIdx - baseIndex;
      const minOffset = minIdx - baseIndex;

      // compute event_pct_mcap
      let eventPctMcap: number | null = null;
      if (ev.event_usd_value != null && ev.mcap_usd != null && Number(ev.mcap_usd) > 0) {
        eventPctMcap = (Number(ev.event_usd_value) / Number(ev.mcap_usd)) * 100;
      }

      const update: any = {
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
      // заповнюємо снапшот MCAP, якщо він ще відсутній
      if (row.mcap_snap == null && ev.mcap_usd != null) {
        update.mcap_snap = Number(ev.mcap_usd);
      }
      // якщо price_snap все ще порожній, дублюємо ціну з T0
      if (row.price_snap == null) {
        const basePrice = closeSeries[preDuration] ?? row.t0_price;
        if (basePrice != null) update.price_snap = basePrice;
      }

      await supabase.from('event_price_reaction').update(update).eq('event_id', ev.id);

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