// @ts-nocheck
// supabase/functions/dropstab-circ/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERSION = "dropstab-circ v2-paging";

function slugifyLite(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normSymbol(s: string) {
  return (s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function pickBestByMcapOrRank(list: any[]) {
  if (!Array.isArray(list) || list.length === 0) return null;

  const withMcap = list
    .map((c) => {
      const mcap =
        c?.marketCap ?? c?.market_cap ?? c?.mcap ?? c?.market_cap_usd ?? null;
      return { c, mcap: mcap == null ? null : Number(mcap) };
    })
    .filter((x) => Number.isFinite(x.mcap));

  if (withMcap.length) {
    withMcap.sort((a, b) => b.mcap - a.mcap);
    return withMcap[0].c;
  }

  const withRank = list
    .map((c) => {
      const rank =
        c?.rank ?? c?.cmcRank ?? c?.marketCapRank ?? c?.market_cap_rank ?? null;
      return { c, rank: rank == null ? null : Number(rank) };
    })
    .filter((x) => Number.isFinite(x.rank));

  if (withRank.length) {
    withRank.sort((a, b) => a.rank - b.rank);
    return withRank[0].c;
  }

  return list[0];
}

async function tryDetailed(apiKey: string, slug: string) {
  const r = await fetch(`https://public-api.dropstab.com/api/v1/coins/detailed/${slug}`, {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });
  if (!r.ok) return { circ: null, status: r.status };
  const j = await r.json();
  const circ = j?.data?.circulatingSupply;
  return { circ: typeof circ === "number" ? circ : null, status: 200 };
}

async function fetchJson(apiKey: string, url: string) {
  const r = await fetch(url, {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });
  const status = r.status;
  let j: any = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  return { status, j, url };
}

function extractContent(j: any) {
  const data = j?.data;

  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.content)
    ? data.content
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.items)
    ? data.items
    : Array.isArray(j?.result?.data)
    ? j.result.data
    : [];

  const meta = {
    totalPages: Number(data?.totalPages ?? NaN),
    pageSize: Number(data?.pageSize ?? NaN),
    currentPage: Number(data?.currentPage ?? NaN),
    totalSize: Number(data?.totalSize ?? NaN),
  };

  return { list, meta };
}

/**
 * ✅ Пейджинг:
 * - API повертає data.content + meta (totalPages/pageSize/currentPage)
 * - ми пробуємо pageSize=1000 і проходимо сторінки, доки не знайдемо symbol
 */
async function findBySymbolInCoins(apiKey: string, symbol: string) {
  const sym = normSymbol(symbol);

  // 1) ✅ швидкі фільтри (якщо API підтримує)
  const filterUrls = [
    `https://public-api.dropstab.com/api/v1/coins?currency=USD&symbol=${encodeURIComponent(sym)}`,
    `https://public-api.dropstab.com/api/v1/coins?currency=USD&query=${encodeURIComponent(sym)}`,
    `https://public-api.dropstab.com/api/v1/coins?currency=USD&search=${encodeURIComponent(sym)}`,
    `https://public-api.dropstab.com/api/v1/coins?currency=USD&keyword=${encodeURIComponent(sym)}`,
    `https://public-api.dropstab.com/api/v1/coins?currency=USD&text=${encodeURIComponent(sym)}`,
  ];

  for (const url of filterUrls) {
    const { status, j, url: usedUrl } = await fetchJson(apiKey, url);
    if (!j || status !== 200) continue;

    const { list, meta } = extractContent(j);
    if (Array.isArray(list) && list.length) {
      const matches = list.filter((c: any) => normSymbol(String(c?.symbol || "")) === sym);
      if (matches.length) {
        const best = pickBestByMcapOrRank(matches);
        return { ok: true, best, matches, meta: { ...meta, url: usedUrl, mode: "filter" } };
      }
    }
  }

  // 2) якщо фільтрів нема — fallback на пагінацію (але робимо більше сторінок)
  const makeUrl = (page: number) =>
    `https://public-api.dropstab.com/api/v1/coins?currency=USD&page=${page}`;

  const maxPagesHard = 300; // ⬅️ збільшуємо, але це все одно повільно

  let lastMeta: any = null;

  for (let page = 1; page <= maxPagesHard; page++) {
    const url = makeUrl(page);
    const { status, j, url: usedUrl } = await fetchJson(apiKey, url);
    if (!j || status !== 200) continue;

    const { list, meta } = extractContent(j);
    lastMeta = { ...meta, url: usedUrl, mode: "paging" };

    const matches = (list || []).filter((c: any) => normSymbol(String(c?.symbol || "")) === sym);
    if (matches.length) {
      const best = pickBestByMcapOrRank(matches);
      return { ok: true, best, matches, meta: lastMeta };
    }

    if (Number.isFinite(meta.totalPages) && page >= meta.totalPages) break;
  }

  return { ok: false, best: null, matches: [], meta: lastMeta };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get("DROPSTAB_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "DROPSTAB_API_KEY missing", version: VERSION }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const coinName = body?.coinName;
    const coinSymbol = body?.coinSymbol;
    const coinSlug = body?.coinSlug;

    // 0) explicit slug
    if (coinSlug) {
      const d = await tryDetailed(apiKey, String(coinSlug));
      return new Response(JSON.stringify({
        circulatingSupply: d.circ,
        via: "explicit_slug",
        slug: coinSlug,
        detailedStatus: d.status,
        version: VERSION,
      }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const raw = String(coinSymbol || coinName || "").trim();
    if (!raw) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "empty input", version: VERSION }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 1) try slugify first (cheap)
    const slug = slugifyLite(raw);
    const d1 = await tryDetailed(apiKey, slug);
    if (d1.circ != null) {
      return new Response(JSON.stringify({
        circulatingSupply: d1.circ,
        via: "detailed_slug",
        slug,
        detailedStatus: d1.status,
        version: VERSION,
      }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const sym = normSymbol(raw);

    // 2) ✅ robust coins paging lookup
    const found = await findBySymbolInCoins(apiKey, sym);

    if (found.ok && found.best?.slug) {
      const chosenSlug = String(found.best.slug);
      const d2 = await tryDetailed(apiKey, chosenSlug);

      return new Response(JSON.stringify({
        circulatingSupply: d2.circ,
        via: found.matches.length > 1 ? "coins_symbol_best_of_many_paged" : "coins_symbol_match_paged",
        symbol: sym,
        slug: chosenSlug,
        name: found.best?.name ?? null,
        matchesCount: found.matches.length,
        matched: {
          symbol: found.best?.symbol ?? null,
          name: found.best?.name ?? null,
          slug: found.best?.slug ?? null,
        },
        version: VERSION,
        debug: {
          pagingMeta: found.meta,
          matchesCount: found.matches.length,
        },
      }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 3) not found
    return new Response(JSON.stringify({
      circulatingSupply: null,
      via: "not_found",
      symbol: sym,
      slug: null,
      version: VERSION,
      debug: { pagingMeta: found.meta },
    }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ circulatingSupply: null, error: String(e), version: VERSION }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 200,
    });
  }
});