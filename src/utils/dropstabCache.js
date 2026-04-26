// src/utils/dropstabCache.js
//
// Shared dropstab-circ cache helper. Looks up `symbol` in the
// `dropstab_cache` table; returns the cached values if `fetched_at` is
// fresher than CACHE_TTL_HOURS. Otherwise calls the provided fetcher and
// upserts the result.
//
// Works in both browser (anon supabase client) and Node script (service-role
// client) contexts. The caller passes the supabase client and a fetcher
// closure that performs the actual Edge Function call.

const CACHE_TTL_HOURS = 6;

function normaliseSymbol(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.toUpperCase();
}

/**
 * @param {object}   opts
 * @param {object}   opts.supabase    supabase-js client (any role)
 * @param {string}   opts.symbol      coin symbol / name (case-insensitive)
 * @param {Function} opts.fetcher     async () => { circulatingSupply, slug }
 * @returns {Promise<{ circulatingSupply: number|null, slug: string|null, cached: boolean }>}
 */
export async function getDropstabCircCached({ supabase, symbol, fetcher }) {
  const key = normaliseSymbol(symbol);
  if (!key || !supabase || typeof fetcher !== 'function') {
    const fresh = await (typeof fetcher === 'function' ? fetcher() : Promise.resolve(null));
    return {
      circulatingSupply: fresh?.circulatingSupply ?? null,
      slug: fresh?.slug ?? null,
      cached: false,
    };
  }

  try {
    const { data: cached } = await supabase
      .from('dropstab_cache')
      .select('symbol,circ_supply,dropstab_slug,fetched_at')
      .eq('symbol', key)
      .maybeSingle();

    if (cached?.fetched_at) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      if (ageMs < CACHE_TTL_HOURS * 60 * 60 * 1000) {
        return {
          circulatingSupply: cached.circ_supply != null ? Number(cached.circ_supply) : null,
          slug: cached.dropstab_slug || null,
          cached: true,
        };
      }
    }
  } catch (err) {
    console.warn('[dropstabCache] read failed', err?.message || err);
  }

  const fresh = await fetcher();
  const circulatingSupply = Number.isFinite(Number(fresh?.circulatingSupply))
    ? Number(fresh.circulatingSupply)
    : null;
  const slug = fresh?.slug || null;

  // Only cache successful lookups (non-null circ supply). Negative results
  // expire faster naturally — we just don't insert them.
  if (circulatingSupply != null) {
    try {
      await supabase
        .from('dropstab_cache')
        .upsert(
          {
            symbol: key,
            circ_supply: circulatingSupply,
            dropstab_slug: slug,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'symbol' },
        );
    } catch (err) {
      console.warn('[dropstabCache] write failed', err?.message || err);
    }
  }

  return { circulatingSupply, slug, cached: false };
}
