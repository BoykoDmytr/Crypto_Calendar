// @ts-nocheck
// supabase/functions/dropstab-circ/index.ts
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

function pickBestByMcapOrRank(list: any[]) {
  if (!Array.isArray(list) || list.length === 0) return null;

  const withMcap = list
    .map((c) => {
      const mcap = c?.marketCap ?? c?.market_cap ?? c?.mcap ?? c?.market_cap_usd ?? null;
      return { c, mcap: mcap == null ? null : Number(mcap) };
    })
    .filter((x) => Number.isFinite(x.mcap));

  if (withMcap.length) {
    withMcap.sort((a, b) => b.mcap - a.mcap);
    return withMcap[0].c;
  }

  const withRank = list
    .map((c) => {
      const rank = c?.rank ?? c?.cmcRank ?? c?.marketCapRank ?? c?.market_cap_rank ?? null;
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

// 1) coins list (може повертати failure навіть з HTTP 200)
async function fetchCoinsList(apiKey: string) {
  const url =
    "https://public-api.dropstab.com/api/v1/coins?currency=USD&rankFrom=1&rankTo=20000";
  const { status, j } = await fetchJson(apiKey, url);

  // DropsTab інколи віддає: {status, data, failure, failureDetails, timestamp}
  const failure = Boolean(j?.failure);
  const data = j?.data;
  const dataType = Array.isArray(j?.data) ? "array" : (j?.data === null ? "null" : typeof j?.data);
  const dataKeys = j?.data && typeof j?.data === "object" && !Array.isArray(j.data) ? Object.keys(j.data) : [];

  const dataPreview = (() => {
  const d = j?.data;
  if (Array.isArray(d)) return { kind: "array", len: d.length };
  if (d && typeof d === "object") {
    const keys = Object.keys(d).slice(0, 10);
    const sample: Record<string, string> = {};
    for (const k of keys) {
      const v = (d as any)[k];
      sample[k] = Array.isArray(v) ? `array(len=${v.length})` : (v === null ? "null" : typeof v);
    }
    return { kind: "object", keys, sample };
  }
  return { kind: dataType };
})();
  // data може бути масивом або обʼєктом з data/items
  const list =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(j?.result?.data) ? j.result.data :
    [];

  return {
    status,
    url,
    failure,
    failureDetails: j?.failureDetails ?? null,
    keys: j && typeof j === "object" ? Object.keys(j) : [],
    list,
    dataType,
    dataKeys,
    dataPreview,
  };
}

// 2) search fallback – пробуємо кілька найімовірніших endpoint’ів
async function searchCoins(apiKey: string, q: string) {
  const query = encodeURIComponent(q);

  // 1) пробуємо API endpoints (як було)
  const candidates = [
    `https://public-api.dropstab.com/api/v1/coins/search?query=${query}`,
    `https://public-api.dropstab.com/api/v1/coins/search?text=${query}`,
    `https://public-api.dropstab.com/api/v1/search?query=${query}`,
    `https://public-api.dropstab.com/api/v1/search?text=${query}`,
  ];

  for (const url of candidates) {
    const { status, j } = await fetchJson(apiKey, url);
    if (!j) continue;

    const list =
      Array.isArray(j?.data) ? j.data :
      Array.isArray(j?.data?.data) ? j.data.data :
      Array.isArray(j?.data?.items) ? j.data.items :
      Array.isArray(j?.items) ? j.items :
      Array.isArray(j?.result?.data) ? j.result.data :
      [];

    if (list.length) return { ok: true, status, url, list, mode: "api" };
  }

  // 2) ✅ fallback: HTML пошук (беремо перший результат “як у UI”)
  // Підставляємо найтиповіший шлях. Якщо відрізняється — скажеш, я піджену.
  const htmlUrl = `https://dropstab.com/search?query=${query}`;

  try {
    const r = await fetch(htmlUrl, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) return { ok: false, status: r.status, url: htmlUrl, list: [], mode: "html" };

    const html = await r.text();

    // шукаємо перший збіг на сторінці, який схожий на URL монети зі slug
    // приклади можуть бути типу /coins/<slug> або /coin/<slug> або /cryptocurrency/<slug>
    const m =
      html.match(/href="\/(coin|coins|cryptocurrency)\/([a-z0-9-]+)"/i) ||
      html.match(/"slug"\s*:\s*"([a-z0-9-]+)"/i);

    const slug = m ? (m[2] || m[1]) : null;
    if (!slug) return { ok: false, status: 200, url: htmlUrl, list: [], mode: "html_no_slug" };

    // повертаємо у форматі list, щоб далі код не міняти
    return { ok: true, status: 200, url: htmlUrl, list: [{ slug }], mode: "html_slug" };
  } catch {
    return { ok: false, status: null, url: htmlUrl, list: [], mode: "html_error" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get("DROPSTAB_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "DROPSTAB_API_KEY missing" }), {
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
      return new Response(JSON.stringify({ circulatingSupply: d.circ, via: "explicit_slug", slug: coinSlug, detailedStatus: d.status }), {
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

    // 1) try slugify (sometimes works)
    const slug = slugifyLite(raw);
    const d1 = await tryDetailed(apiKey, slug);
    if (d1.circ != null) {
      return new Response(JSON.stringify({ circulatingSupply: d1.circ, via: "detailed_slug", slug, detailedStatus: d1.status }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const sym = normSymbol(raw);

    // 2) try coins list
    const coinsResp = await fetchCoinsList(apiKey);

    // if coins list is usable
    if (coinsResp.list.length) {
      const matches = coinsResp.list.filter((c: any) => normSymbol(String(c?.symbol || "")) === sym);
      const best = pickBestByMcapOrRank(matches);

      if (best?.slug) {
        const chosenSlug = String(best.slug);
        const d2 = await tryDetailed(apiKey, chosenSlug);

        return new Response(JSON.stringify({
          circulatingSupply: d2.circ,
          via: matches.length > 1 ? "coins_symbol_best_of_many" : "coins_symbol_match",
          symbol: sym,
          slug: chosenSlug,
          matchesCount: matches.length,
          matched: { symbol: best?.symbol ?? null, name: best?.name ?? null, slug: best?.slug ?? null },
          debug: {
            coinsStatus: coinsResp.status,
            coinsCount: (coinsResp.list || []).length,
            coinsFailure: coinsResp.failure,
            coinsFailureDetails: coinsResp.failureDetails,
            coinsKeys: coinsResp.keys,
            coinsDataType: coinsResp.dataType,
            coinsDataKeys: coinsResp.dataKeys,
            coinsUrl: coinsResp.url,
            coinsDataPreview: coinsResp.dataPreview,
          }
        }), {
          headers: { ...corsHeaders, "content-type": "application/json" },
          status: 200,
        });
      }
    }

    // 3) search fallback (як у UI пошуку)
    const s = await searchCoins(apiKey, sym);

    if (s.ok && s.list.length) {
      // search results можуть містити різні ключі: slug / coinSlug / id
      // намагаємось взяти slug з найпершого/топового
      const best = pickBestByMcapOrRank(s.list);
      const foundSlug = String(best?.slug || best?.coinSlug || "").trim();

      if (foundSlug) {
        const d3 = await tryDetailed(apiKey, foundSlug);
        return new Response(JSON.stringify({
          circulatingSupply: d3.circ,
          via: "search_top",
          symbol: sym,
          slug: foundSlug,
          matched: { symbol: best?.symbol ?? null, name: best?.name ?? null, slug: foundSlug },
          debug: {
            coinsStatus: coinsResp.status,
            coinsCount: (coinsResp.list || []).length,
            coinsFailure: coinsResp.failure,
            coinsFailureDetails: coinsResp.failureDetails,
            coinsKeys: coinsResp.keys,
            coinsDataType: coinsResp.dataType,
            coinsDataKeys: coinsResp.dataKeys,
            coinsUrl: coinsResp.url,
            coinsDataPreview: coinsResp.dataPreview,
            searchMode: s.mode,
          }
        }), {
          headers: { ...corsHeaders, "content-type": "application/json" },
          status: 200,
        });
      }
    }

    return new Response(JSON.stringify({
      circulatingSupply: null,
      via: "not_found",
      symbol: sym,
      slug,
      debug: {
        coinsStatus: coinsResp.status,
        coinsCount: (coinsResp.list || []).length,
        coinsFailure: coinsResp.failure,
        coinsFailureDetails: coinsResp.failureDetails,
        coinsKeys: coinsResp.keys,
        coinsDataType: coinsResp.dataType,
        coinsDataKeys: coinsResp.dataKeys,
        coinsDataPreview: coinsResp.dataPreview,
        coinsUrl: coinsResp.url,
        searchMode: s.mode,
      },
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