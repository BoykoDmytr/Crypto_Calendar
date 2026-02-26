// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function pickBestByMcapOrRank(matches: any[]) {
  if (!Array.isArray(matches) || matches.length === 0) return null;

  const withMcap = matches
    .map((c) => {
      const mcap =
        c?.marketCap ?? c?.market_cap ?? c?.mcap ?? c?.marketCapUsd ?? c?.market_cap_usd ?? null;
      return { c, mcap: mcap == null ? null : Number(mcap) };
    })
    .filter((x) => Number.isFinite(x.mcap));
  if (withMcap.length) {
    withMcap.sort((a, b) => b.mcap - a.mcap);
    return withMcap[0].c;
  }

  const withRank = matches
    .map((c) => {
      const rank = c?.rank ?? c?.cmcRank ?? c?.marketCapRank ?? c?.market_cap_rank ?? null;
      return { c, rank: rank == null ? null : Number(rank) };
    })
    .filter((x) => Number.isFinite(x.rank));
  if (withRank.length) {
    withRank.sort((a, b) => a.rank - b.rank);
    return withRank[0].c;
  }

  return matches[0];
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
  const url = "https://public-api.dropstab.com/api/v1/coins?currency=USD&rankFrom=1&rankTo=20000";

  const r = await fetch(url, {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });

  const status = r.status;

  let j: any = null;
  try {
    j = await r.json();
  } catch {
    return { list: [], status, url, rawShape: "non_json" };
  }

  const candidates = [j?.data, j?.result?.data, j?.result, j?.items, j?.payload?.data];
  const list = candidates.find((x) => Array.isArray(x)) || [];

  const rawShape = Array.isArray(j?.data)
    ? "data"
    : Array.isArray(j?.result?.data)
    ? "result.data"
    : Array.isArray(j?.items)
    ? "items"
    : "unknown";

  return { list, status, url, rawShape };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  let detailedStatus: number | null = null;

  try {
    const { coinName, coinSymbol, coinSlug } = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get("DROPSTAB_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "DROPSTAB_API_KEY missing" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    if (coinSlug) {
      const d = await tryDetailed(apiKey, String(coinSlug));
      detailedStatus = d.status;
      return new Response(JSON.stringify({ circulatingSupply: d.circ, via: "explicit_slug", slug: coinSlug, detailedStatus }), {
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

    // 1) try slugify
    const slug = slugifyLite(raw);
    const d1 = await tryDetailed(apiKey, slug);
    detailedStatus = d1.status;
    if (d1.circ != null) {
      return new Response(JSON.stringify({ circulatingSupply: d1.circ, via: "detailed_slug", slug, detailedStatus }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 2) best-of-many by symbol
    const sym = normSymbol(raw);
    const coinsResp = await fetchCoinsList(apiKey);

    const matches = (coinsResp.list || []).filter((c: any) => normSymbol(String(c?.symbol || "")) === sym);
    const best = pickBestByMcapOrRank(matches);

    if (best?.slug) {
      const chosenSlug = String(best.slug);
      const d2 = await tryDetailed(apiKey, chosenSlug);
      detailedStatus = d2.status;

      return new Response(JSON.stringify({
        circulatingSupply: d2.circ,
        via: matches.length > 1 ? "symbol_best_of_many" : "symbol_match",
        symbol: sym,
        slug: chosenSlug,
        matchesCount: matches.length,
        matched: { symbol: best?.symbol ?? null, name: best?.name ?? null, slug: best?.slug ?? null },
        debug: { coinsStatus: coinsResp.status, coinsCount: (coinsResp.list || []).length, coinsUrl: coinsResp.url, rawShape: coinsResp.rawShape, detailedStatus },
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
      debug: { coinsStatus: coinsResp.status, coinsCount: (coinsResp.list || []).length, coinsUrl: coinsResp.url, rawShape: coinsResp.rawShape, detailedStatus },
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