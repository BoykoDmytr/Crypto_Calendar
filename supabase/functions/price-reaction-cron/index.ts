// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import dayjs from "npm:dayjs@1.11.10";
import utc from "npm:dayjs@1.11.10/plugin/utc.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

dayjs.extend(utc);

const LOOKAHEAD_DAYS = 30;          // скільки днів вперед підтримуємо (постав хоч 60)
const CAPTURE_WINDOW_MINUTES = 10;  // вікно після targetTime (щоб точно не промахнутись)

function normalizeMexcSymbol(raw: string | null) {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 6) return null;
  return cleaned;
}

function shouldCapture(nowUtc: dayjs.Dayjs, targetUtc: dayjs.Dayjs) {
  const diff = nowUtc.diff(targetUtc, "minute", true);
  return diff >= 0 && diff <= CAPTURE_WINDOW_MINUTES;
}

function calcPercent(base: number | null, next: number | null) {
  if (base == null || next == null || base === 0) return null;
  return ((next - base) / base) * 100;
}

// MEXC ticker (server-side, no CORS)
async function fetchMexcTickerPrice(symbol: string): Promise<number | null> {
  try {
    const url = new URL("https://api.mexc.com/api/v3/ticker/price");
    url.searchParams.set("symbol", symbol);
    const res = await fetch(url.toString(), { headers: { "accept": "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const p = Number(data?.price ?? data?.lastPrice);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {

  // (опційно) простий захист: якщо хочеш — перевіряй секретний хедер
  // const secret = Deno.env.get("CRON_SECRET");
  // if (secret && req.headers.get("x-cron-secret") !== secret) {
  //   return new Response("Unauthorized", { status: 401 });
  // }

  const SUPABASE_URL = Deno.env.get("PROJECT_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const nowUtc = dayjs.utc();
  const windowStart = nowUtc.subtract(1, "day").toISOString();
  const windowEnd = nowUtc.add(LOOKAHEAD_DAYS, "day").toISOString();

  // 1) беремо типи, які треба трекати (track_in_stats=true)
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

  // fallback якщо порожньо
  if (slugs.size === 0 && names.size === 0) {
    ["binance_tournament", "ts_bybit", "booster"].forEach((s) => slugs.add(s));
    ["Binance Tournaments", "TS Bybit", "Booster"].forEach((n) => names.add(n));
  }

  // 2) беремо івенти в часовому вікні
  const { data: events, error: eventsErr } = await supabase
    .from("events_approved")
    .select("id,title,start_at,type,event_type_slug,coin_name,tge_exchanges,coin_price_link,link")
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

  // 3) існуючі записи реакцій
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

      // визначаємо пару
      const exchanges = Array.isArray(ev.tge_exchanges) ? ev.tge_exchanges : [];
      const entry = exchanges.find((x: any) => x?.pair?.toUpperCase?.().includes("USDT")) ?? exchanges[0];

      let pair = entry?.pair ?? null;

      // fallback з лінка
      if (!pair) {
        const cleaned = String(ev.coin_price_link ?? ev.link ?? "").trim();
        const m = cleaned.match(/[A-Z0-9]{2,}[_/]*USDT/i);
        pair = m ? m[0] : null;
      }

      const apiPair = normalizeMexcSymbol(pair);

      // якщо нема пари — пропускаємо
      if (!apiPair) {
        skipped++;
        continue;
      }

      const row = map.get(ev.id);

      // якщо запису нема — вставляємо заготовку
      if (!row) {
        const payload = {
          event_id: ev.id,
          coin_name: ev.coin_name ?? null,
          pair: pair,
          exchange: entry?.exchange ?? null,
          t0_time: t0.toISOString(),
          t0_price: null,
          t0_percent: 0,
          t_plus_5_time: t5.toISOString(),
          t_plus_5_price: null,
          t_plus_5_percent: null,
          t_plus_15_time: t15.toISOString(),
          t_plus_15_price: null,
          t_plus_15_percent: null,
        };

        const { error } = await supabase.from("event_price_reaction").insert(payload);
        if (error) throw error;
        inserted++;
        map.set(ev.id, payload);
        continue;
      }

      // оновлення
      const patch: any = {};
      const basePrice = row.t0_price;

      // T0
      if (row.t0_price == null && shouldCapture(nowUtc, t0)) {
        const p0 = await fetchMexcTickerPrice(apiPair);
        if (p0 != null) {
          patch.t0_price = p0;
          patch.t0_percent = 0;
        }
      }

      const base = patch.t0_price ?? row.t0_price;

      // T+5
      if (row.t_plus_5_price == null && base != null && shouldCapture(nowUtc, t5)) {
        const p5 = await fetchMexcTickerPrice(apiPair);
        if (p5 != null) {
          patch.t_plus_5_price = p5;
          patch.t_plus_5_percent = calcPercent(base, p5);
        }
      }

      // T+15
      if (row.t_plus_15_price == null && base != null && shouldCapture(nowUtc, t15)) {
        const p15 = await fetchMexcTickerPrice(apiPair);
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
      } else {
        skipped++;
      }
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
