// scripts/resolve-coin-info.js
//
// This script populates coin_price_link and coin_circulating_supply fields for
// events in the database that have a contract address but no price link yet.
// It uses the CoinGecko API to fetch token metadata and find the MEXC USDT
// trading pair with the highest volume.  After resolving, it updates the
// relevant event record in Supabase.

/*
 * To run this script you need Node.js 18+ (for native fetch) and a Service Role
 * Supabase key with write access.  Set the following environment variables:
 *  - SUPABASE_URL: your Supabase project URL
 *  - SUPABASE_SERVICE_ROLE_KEY: service role API key
 *  - CG_API_KEY: optional CoinGecko API key (for higher rate limits)
 *
 * Example:
 *   SUPABASE_URL=https://xyz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
 *   node scripts/resolve-coin-info.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CG_API_KEY = process.env.CG_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fetchJson(url) {
  const headers = {};
  if (CG_API_KEY) {
    // CoinGecko allows passing API key via header or query param
    headers['x-cg-demo-api-key'] = CG_API_KEY;
  }
  const res = await fetch(url, { headers, timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function getUnresolvedEvents() {
  const { data, error } = await supabase
    .from('events_approved')
    .select('*')
    .is('coin_price_link', null)
    .not('coin_address', 'is', null);
  if (error) throw error;
  return data || [];
}

/**
 * Resolve a single event:
 *  - Calls CoinGecko for the token metadata using its contract address and chain
 *  - Extracts the circulating supply
 *  - Finds the MEXC USDT ticker with the highest volume
 *  - Updates the event record with coin_price_link and coin_circulating_supply
 */
async function resolveEvent(ev) {
  const chain = ev.coin_chain || 'ethereum';
  const addr = String(ev.coin_address).toLowerCase();
  const url = `https://api.coingecko.com/api/v3/coins/${chain}/contract/${addr}?tickers=true`;
  const json = await fetchJson(url);

  // pull circulating supply if available
  const supply = json?.market_data?.circulating_supply ?? null;

  // find MEXC USDT ticker with max volume
  let bestTicker = null;
  for (const t of json.tickers || []) {
    if (t.market?.identifier !== 'mexc') continue;
    if (!t.target || t.target.toUpperCase() !== 'USDT') continue;
    if (!bestTicker || (t.volume ?? 0) > (bestTicker.volume ?? 0)) {
      bestTicker = t;
    }
  }

  let priceLink = null;
  if (bestTicker) {
    const base = String(bestTicker.base || '').toUpperCase();
    const target = String(bestTicker.target || '').toUpperCase();
    // spot link format; adjust to futures if needed
    priceLink = `https://www.mexc.com/exchange/${base}/${target}`;
  }

  // update event record
  const patch = {};
  if (priceLink) patch.coin_price_link = priceLink;
  if (supply != null) patch.coin_circulating_supply = supply;
  if (Object.keys(patch).length === 0) {
    console.warn(`No data to update for event ${ev.id}`);
    return;
  }
  const { error } = await supabase
    .from('events_approved')
    .update(patch)
    .eq('id', ev.id);
  if (error) throw error;
  console.log(`Updated event ${ev.id}:`, patch);
}

async function run() {
  const events = await getUnresolvedEvents();
  console.log(`Found ${events.length} event(s) to resolve`);
  for (const ev of events) {
    try {
      await resolveEvent(ev);
    } catch (err) {
      console.error(`Error resolving ${ev.id}:`, err);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});