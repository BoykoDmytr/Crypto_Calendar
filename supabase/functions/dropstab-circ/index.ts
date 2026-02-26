// @ts-nocheck
// supabase/functions/dropstab-circ/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ✅ manual aliases for ambiguous tickers
// BTR у DropsTab має кілька монет. Беремо “верхню / основну” — Bitrue Coin.
// Якщо раптом slug інший — ти просто зміниш значення тут на правильний.
const ALIASES: Record<string, string> = {
  BTR: "bitrue-coin",
};

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

async function tryDetailed(apiKey: string, slug: string) {
  const r = await fetch(`https://public-api.dropstab.com/api/v1/coins/detailed/${slug}`, {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });
  if (!r.ok) return { circ: null, status: r.status };
  const j = await r.json();
  const circ = j?.data?.circulatingSupply;
  return { circ: typeof circ === "number" ? circ : null, status: 200 };
}

async function fetchCoinsList(apiKey: string) {
  const url =
    "https://public-api.dropstab.com/api/v1/coins?currency=USD&rankFrom=1&rankTo=20000";
  const r = await fetch(url, {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });
  if (!r.ok) return { list: [], status: r.status, url };
  const j = await r.json();
  return { list: Array.isArray(j?.data) ? j.data : [], status: 200, url };
}

function pickBestCandidate(list: any[]) {
  if (!Array.isArray(list) || list.length === 0) return null;

  // 1) якщо є rank — найменший rank
  const withRank = list
    .map((c) => {
      const rank =
        c?.rank ??
        c?.cmcRank ??
        c?.marketCapRank ??
        c?.market_cap_rank ??
        null;
      return { c, rank: rank == null ? null : Number(rank) };
    })
    .filter((x) => Number.isFinite(x.rank));

  if (withRank.length) {
    withRank.sort((a, b) => a.rank - b.rank);
    return withRank[0].c;
  }

  // 2) якщо є marketCap — найбільший
  const withMcap = list
    .map((c) => {
      const mcap = c?.marketCap ?? c?.market_cap ?? c?.mcap ?? null;
      return { c, mcap: mcap == null ? null : Number(mcap) };
    })
    .filter((x) => Number.isFinite(x.mcap));

  if (withMcap.length) {
    withMcap.sort((a, b) => b.mcap - a.mcap);
    return withMcap[0].c;
  }

  return list[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const coinName = body?.coinName;
    const coinSymbol = body?.coinSymbol;
    const coinSlug = body?.coinSlug;

    const apiKey = Deno.env.get("DROPSTAB_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "DROPSTAB_API_KEY missing" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 0) якщо передали slug — беремо напряму
    if (coinSlug) {
      const r = await tryDetailed(apiKey, String(coinSlug));
      return new Response(JSON.stringify({ circulatingSupply: r.circ, via: "explicit_slug", slug: coinSlug, detailedStatus: r.status }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const raw = String(coinSymbol || coinName || "").trim();
    if (!raw) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "empty input" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const sym = normSymbol(raw);

    // ✅ 0.5) Alias (беремо “верхній / основний” варіант)
    const aliasSlug = ALIASES[sym];
    if (aliasSlug) {
      const r = await tryDetailed(apiKey, aliasSlug);
      return new Response(JSON.stringify({
        circulatingSupply: r.circ,
        via: "alias",
        symbol: sym,
        slug: aliasSlug,
        detailedStatus: r.status,
      }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 1) спроба як slug з назви/символу
    const slug = slugifyLite(raw);
    let rDetail = await tryDetailed(apiKey, slug);
    if (rDetail.circ != null) {
      return new Response(JSON.stringify({ circulatingSupply: rDetail.circ, via: "detailed_slug", slug, detailedStatus: rDetail.status }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 2) lookup по symbol (best-of-many)
    const coinsResp = await fetchCoinsList(apiKey);
    const list = coinsResp.list;

    const matches = list.filter((c: any) => normSymbol(String(c?.symbol || "")) === sym);
    const best = pickBestCandidate(matches);

    if (best?.slug) {
      const foundSlug = String(best.slug);
      const r2 = await tryDetailed(apiKey, foundSlug);

      return new Response(JSON.stringify({
        circulatingSupply: r2.circ,
        via: matches.length > 1 ? "symbol_best_of_many" : "symbol_match",
        symbol: sym,
        slug: foundSlug,
        matchesCount: matches.length,
        matched: { symbol: best?.symbol ?? null, name: best?.name ?? null, slug: best?.slug ?? null },
        debug: { coinsStatus: coinsResp.status, coinsCount: list.length, coinsUrl: coinsResp.url, detailedStatus: r2.status },
      }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({
      circulatingSupply: null,
      via: "not_found",
      symbol: sym,
      slug,
      debug: { coinsStatus: coinsResp.status, coinsCount: list.length, coinsUrl: coinsResp.url, detailedStatus: rDetail.status },
    }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ circulatingSupply: null, error: String(e) }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 200,
    });
  }
});