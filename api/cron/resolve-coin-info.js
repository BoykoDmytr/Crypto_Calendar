/* eslint-env node */
/* global process */

// This Vercel cron handler resolves unresolved coin metadata for events. It
// runs on a schedule configured in vercel.json. When a new event is created
// with a coin_address and no coin_price_link, this script contacts
// CoinGecko to fetch the token’s circulating supply and find the best
// MEXC/USDT trading pair. The resulting circulating supply is stored in
// coin_circulating_supply and the exchange link is stored in
// coin_price_link. Subsequent price updates rely solely on MEXC, so
// CoinGecko is only hit once per event, keeping you under the free tier
// limits.

import { createClient } from "@supabase/supabase-js";

/**
 * Fetch JSON from a URL, optionally attaching the CoinGecko API key.
 * Throws an error if the HTTP request fails.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  const headers = {};
  const key = process.env.CG_API_KEY;
  // CoinGecko Demo/Public keys are passed via x-cg-demo-api-key. For Pro you
  // would prefix your base URL with pro-api, but here we support both.
  if (key) headers["x-cg-demo-api-key"] = key;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Select the best MEXC USDT ticker by volume. Returns null if none found.
 *
 * @param {any[]} tickers
 * @returns {any|null}
 */
function pickBestMexcUsdtTicker(tickers) {
  let best = null;
  for (const t of tickers || []) {
    // We only care about MEXC spot markets with USDT target
    if (t?.market?.identifier !== "mexc") continue;
    const target = String(t?.target || "").toUpperCase();
    if (target !== "USDT") continue;
    const vol = Number(t?.volume || 0);
    if (!best || vol > Number(best?.volume || 0)) best = t;
  }
  return best;
}

export default async function handler(req, res) {
  // Optional secret protection: supply a CRON_SECRET env var and send
  // Authorization: Bearer <secret> from the Vercel scheduler if desired.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).send("Unauthorized");
    }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Fetch events that have a coin_address but no coin_price_link yet.
  const { data: events, error } = await supabase
    .from("events_approved")
    .select("id, coin_address, coin_chain, coin_price_link, coin_circulating_supply")
    .is("coin_price_link", null)
    .not("coin_address", "is", null);

  if (error) {
    return res.status(500).json({ error: error.message, where: "events_approved select" });
  }

  let resolved = 0;
  let skipped = 0;
  let failures = 0;

  for (const ev of events || []) {
    try {
      const chain = ev.coin_chain || "ethereum";
      const addr = String(ev.coin_address || "").trim().toLowerCase();
      if (!addr) {
        skipped++;
        continue;
      }

      const apiUrl = `https://api.coingecko.com/api/v3/coins/${chain}/contract/${addr}?tickers=true`;
      const json = await fetchJson(apiUrl);

      const supply = json?.market_data?.circulating_supply ?? null;
      const ticker = pickBestMexcUsdtTicker(json?.tickers);
      let priceLink = null;
      if (ticker) {
        const base = String(ticker.base || "").toUpperCase();
        const target = String(ticker.target || "").toUpperCase();
        priceLink = `https://www.mexc.com/exchange/${base}/${target}`;
      }

      // If we can’t find supply or ticker, skip this event
      if (supply == null && !priceLink) {
        skipped++;
        continue;
      }

      const patch = {};
      if (supply != null) patch.coin_circulating_supply = supply;
      if (priceLink) patch.coin_price_link = priceLink;

      const { error: updErr } = await supabase
        .from("events_approved")
        .update(patch)
        .eq("id", ev.id);

      if (updErr) throw updErr;
      resolved++;
    } catch (e) {
      failures++;
      // Log to Vercel’s function logs for debugging.
      console.error("resolve-coin-info cron error for event", ev?.id, e?.message || e);
    }
  }

  return res.status(200).json({ ok: true, total: events.length, resolved, skipped, failures });
}