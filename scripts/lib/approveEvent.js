/* eslint-env node */
// Shared approve/reject logic for pending events. Imported by:
//   - src/pages/Admin.jsx          (browser, anon client)
//   - api/telegram/webhook.js      (Node, service-role client)
//
// Keep it framework-free: no React imports, no DOM access. Receives a
// supabase client from the caller. Uses extractCoinEntries / parseCoinQuantity
// from src/utils/coins.js and getDropstabCircCached from
// src/utils/dropstabCache.js — both pure JS modules.

import { extractCoinEntries, parseCoinQuantity } from "../../src/utils/coins.js";
import { getDropstabCircCached } from "../../src/utils/dropstabCache.js";

// ---------------------------------------------------------------------------
// Column whitelist (mirrors Admin.jsx approve())
// ---------------------------------------------------------------------------
const APPROVED_ALLOWED_COLUMNS = [
  "title",
  "description",
  "start_at",
  "end_at",
  "timezone",
  "type",
  "tge_exchanges",
  "link",
  "nickname",
  "coins",
  "coin_name",
  "coin_quantity",
  "coin_price_link",
  "show_mcap",
  "mcap_usd",
  "mcap_coins",
];

// ---------------------------------------------------------------------------
// Small helpers (mirror Admin.jsx)
// ---------------------------------------------------------------------------

const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  return +m[1] * 60 + +m[2];
};

function formatPct(p) {
  if (p == null || !Number.isFinite(p)) return "";
  const abs = Math.abs(p);
  if (abs >= 1) return p.toFixed(2);
  if (abs >= 0.1) return p.toFixed(3);
  if (abs >= 0.01) return p.toFixed(4);
  return p.toExponential(2);
}

function extractMexcSymbol(coinName, priceLink) {
  if (priceLink && typeof priceLink === "string") {
    const m = priceLink.match(/\/(futures|exchange)\/([A-Z0-9]+)_([A-Z0-9]+)/i);
    if (m) {
      const base = (m[2] || "").toUpperCase();
      const isFutures = (m[1] || "").toLowerCase() === "futures";
      return {
        symbol: isFutures ? `${base}_USDT` : `${base}USDT`,
        market: isFutures ? "futures" : "spot",
      };
    }
    const m2 = priceLink.match(/([A-Z0-9]{2,})_USDT/i);
    if (m2) {
      const base = (m2[1] || "").toUpperCase();
      const isFutures = /\/futures\//i.test(priceLink);
      return {
        symbol: isFutures ? `${base}_USDT` : `${base}USDT`,
        market: isFutures ? "futures" : "spot",
      };
    }
  }
  if (coinName) {
    const tok = String(coinName).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (tok) return { symbol: `${tok}USDT`, market: "spot" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// MEXC price fetcher
//
// In the browser we go through the same-origin /api/mexc-ticker proxy (no
// CORS, cached on the CDN). On the server we hit MEXC directly so the
// webhook does not depend on its own deployment routing. Caller can override
// via the `mexcPriceFetcher` option.
// ---------------------------------------------------------------------------

const isServer = typeof window === "undefined";

async function serverMexcPriceFetcher(symbol, { market = "spot" } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("missing symbol");

  const url =
    market === "futures"
      ? `https://api.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(sym)}`
      : `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`;

  const controller = new AbortController();
  // Keep this short: the approve flow is sequential over coins, and Vercel's
  // function budget is 30s. A 10s hang per coin trivially overruns that.
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`MEXC HTTP ${res.status}`);
    const json = await res.json();
    let price = null;
    if (market === "spot") {
      price = Number(json?.price);
    } else {
      const data = json?.data;
      if (Array.isArray(data)) {
        const found = data.find(
          (x) => String(x?.symbol || "").toUpperCase() === sym,
        );
        price = Number(found?.lastPrice);
      } else {
        price = Number(data?.lastPrice);
      }
    }
    if (!Number.isFinite(price)) throw new Error("invalid price payload");
    return { price, source: "mexc-direct" };
  } finally {
    clearTimeout(timer);
  }
}

async function browserMexcPriceFetcher(symbol, opts) {
  const mod = await import("../../src/utils/fetchMexcTicker.js");
  return mod.fetchMexcTickerPrice(symbol, opts);
}

const defaultMexcPriceFetcher = isServer
  ? serverMexcPriceFetcher
  : browserMexcPriceFetcher;

// ---------------------------------------------------------------------------
// Dropstab lookup
// ---------------------------------------------------------------------------

const DROPSTAB_TIMEOUT_MS = 8_000;

async function fetchCircSupplyViaFn(supabase, coinName) {
  try {
    return await getDropstabCircCached({
      supabase,
      symbol: coinName,
      fetcher: async () => {
        // Race the invoke against a hard timeout. Even if dropstab-circ
        // returns fast on cache hits, the Edge Function can fall through to
        // 300 pages of dropstab API calls on a miss — that blocks the
        // approve flow for 30+ seconds and trips Vercel's maxDuration.
        try {
          const result = await Promise.race([
            supabase.functions.invoke("dropstab-circ", { body: { coinName } }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("dropstab-circ timeout")),
                DROPSTAB_TIMEOUT_MS,
              ),
            ),
          ]);
          const { data, error } = result || {};
          if (error) return { circulatingSupply: null, slug: null };
          const circulatingSupply =
            typeof data?.circulatingSupply === "number"
              ? data.circulatingSupply
              : null;
          const slug =
            circulatingSupply != null &&
            typeof data?.slug === "string" &&
            data.slug
              ? data.slug
              : null;
          return { circulatingSupply, slug };
        } catch (e) {
          // supabase.functions.invoke can throw on undici network errors
          // ("TypeError: fetch failed"). Never let that bubble up — the
          // approve flow should proceed without enrichment.
          console.warn(
            "[approveEvent] dropstab-circ fetch failed:",
            coinName,
            e?.message,
          );
          return { circulatingSupply: null, slug: null };
        }
      },
    });
  } catch (e) {
    console.warn(
      "[approveEvent] dropstab cache wrapper failed:",
      coinName,
      e?.message,
    );
    return { circulatingSupply: null, slug: null };
  }
}

// ---------------------------------------------------------------------------
// Enrichment — mirrors Admin.jsx enrichPayloadWithCircPct exactly
// ---------------------------------------------------------------------------

export async function enrichPayloadWithCircPct(supabase, payload, opts = {}) {
  const mexcPriceFetcher = opts.mexcPriceFetcher || defaultMexcPriceFetcher;
  const entries = extractCoinEntries(payload);
  if (!entries.length) return payload;

  const hasCustomCoins =
    payload.mcap_coins != null &&
    Number.isFinite(Number(payload.mcap_coins)) &&
    Number(payload.mcap_coins) > 0;
  const customCoins = hasCustomCoins ? Number(payload.mcap_coins) : null;

  const circList = [];
  const pctList = [];
  const enrichedCoins = [];
  let mcapUsdWritten = false;

  for (const entry of entries) {
    const name = (entry?.name || "").trim();
    const qty = parseCoinQuantity(entry?.quantity);

    let circ = null;
    let pct = null;
    let dropstabSlug = null;

    if (name && qty != null && qty > 0) {
      if (hasCustomCoins) {
        pct = (qty / customCoins) * 100;
        circ = customCoins;

        const priceLink = entry?.price_link || payload.coin_price_link || "";
        const mexcMeta = extractMexcSymbol(name, priceLink);

        // Fire MEXC and Dropstab in parallel — they're independent and
        // keeping them serial doubles the worst-case latency per coin,
        // which adds up fast in events with multiple coins and blows past
        // Vercel's 30s budget.
        const mexcPromise = mexcMeta?.symbol
          ? mexcPriceFetcher(mexcMeta.symbol, {
              market: mexcMeta.market || "spot",
            }).catch((e) => {
              console.warn(
                "[approveEvent] MEXC price fetch failed:",
                name,
                e?.message,
              );
              return null;
            })
          : Promise.resolve(null);
        const dropstabPromise = fetchCircSupplyViaFn(supabase, name);

        const [mexcResult, dropstabData] = await Promise.all([
          mexcPromise,
          dropstabPromise,
        ]);

        const price = mexcResult?.price ?? null;
        if (price != null && Number.isFinite(price) && price > 0) {
          payload.event_usd_value = qty * price;
          if (!mcapUsdWritten) {
            payload.mcap_usd = customCoins * price;
            mcapUsdWritten = true;
          }
        }

        dropstabSlug = dropstabData?.slug ?? null;
      } else {
        const dropstabData = await fetchCircSupplyViaFn(supabase, name);
        circ = dropstabData?.circulatingSupply ?? null;
        dropstabSlug = dropstabData?.slug ?? null;
        if (circ != null && circ > 0) pct = (qty / circ) * 100;
      }
    }

    enrichedCoins.push({
      ...entry,
      circ_supply: circ,
      pct_circ: pct,
      dropstab_slug: dropstabSlug || null,
    });

    circList.push(circ != null ? String(circ) : "");
    pctList.push(pct != null ? formatPct(pct) : "");
  }

  // coins column on events_approved is TEXT — must be JSON-stringified.
  payload.coins = JSON.stringify(enrichedCoins);
  payload.coin_circ_supply = circList.join("\n");
  payload.coin_pct_circ = pctList.join("\n");

  const firstCoin = enrichedCoins[0];
  if (firstCoin?.circ_supply != null) {
    payload.coin_circulating_supply = firstCoin.circ_supply;
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Build payload from a pending row (same shaping as Admin.jsx approve())
// ---------------------------------------------------------------------------

function buildApprovedPayload(ev) {
  const payload = Object.fromEntries(
    Object.entries(ev).filter(([k]) => APPROVED_ALLOWED_COLUMNS.includes(k)),
  );

  if (Array.isArray(ev.tge_exchanges)) {
    payload.tge_exchanges = [...ev.tge_exchanges].sort(
      (a, b) => toMinutes(a?.time) - toMinutes(b?.time),
    );
  }

  if (Array.isArray(payload.coins)) {
    payload.coins = payload.coins.map((coin) => ({ ...coin }));
  }

  if (payload.end_at === "" || payload.end_at == null) delete payload.end_at;

  if ("nickname" in payload) {
    const trimmed = (payload.nickname || "").trim();
    if (trimmed) payload.nickname = trimmed;
    else delete payload.nickname;
  }

  return payload;
}

function sourceToTable(source) {
  if (source === "auto_pending") return "auto_events_pending";
  if (source === "pending") return "events_pending";
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Move a pending row into events_approved with full enrichment.
 *
 * @param {object} opts
 * @param {object} opts.supabase  supabase-js client
 * @param {'pending'|'auto_pending'} opts.source
 * @param {string} opts.id        pending row UUID
 * @param {object} [opts.row]     pre-fetched pending row (saves a round-trip)
 * @param {Function} [opts.mexcPriceFetcher]
 * @returns {Promise<{ok: true, approvedId: string} | {ok: false, reason: string}>}
 */
export async function approvePendingEvent({
  supabase,
  source,
  id,
  row,
  mexcPriceFetcher,
}) {
  const table = sourceToTable(source);
  if (!table) return { ok: false, reason: "invalid_source" };
  if (!id) return { ok: false, reason: "invalid_id" };

  let pending = row;
  if (!pending) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!data) return { ok: false, reason: "not_found" };
    pending = data;
  }

  const payload = buildApprovedPayload(pending);
  // Enrichment hits external APIs (MEXC, Dropstab). Treat it as best-effort:
  // a network blip from Vercel must not abort the approve, otherwise the
  // pending row gets stuck and the Telegram bot reports "TypeError: fetch
  // failed".
  try {
    await enrichPayloadWithCircPct(supabase, payload, { mexcPriceFetcher });
  } catch (e) {
    console.warn(
      "[approveEvent] enrichment failed, proceeding with raw payload:",
      e?.message,
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from("events_approved")
    .insert(payload)
    .select("id")
    .single();

  if (insErr) return { ok: false, reason: insErr.message };

  const { error: delErr } = await supabase.from(table).delete().eq("id", id);
  if (delErr) {
    // Insert already succeeded; we leak a pending row. Surface but don't roll
    // back — the duplicate is preferable to losing the approved event.
    return {
      ok: true,
      approvedId: inserted?.id,
      warning: `delete_pending_failed: ${delErr.message}`,
    };
  }

  return { ok: true, approvedId: inserted?.id };
}

/**
 * Delete a pending row.
 *
 * @param {object} opts
 * @param {object} opts.supabase
 * @param {'pending'|'auto_pending'} opts.source
 * @param {string} opts.id
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function rejectPendingEvent({ supabase, source, id }) {
  const table = sourceToTable(source);
  if (!table) return { ok: false, reason: "invalid_source" };
  if (!id) return { ok: false, reason: "invalid_id" };

  const { data: existing, error: selErr } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (selErr) return { ok: false, reason: selErr.message };
  if (!existing) return { ok: false, reason: "not_found" };

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
