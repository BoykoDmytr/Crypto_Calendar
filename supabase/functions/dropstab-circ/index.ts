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

async function tryDetailed(apiKey: string, slug: string) {
  const r = await fetch(`https://public-api.dropstab.com/api/v1/coins/detailed/${slug}`, {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const circ = j?.data?.circulatingSupply;
  return typeof circ === "number" ? circ : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const { coinName } = await req.json();
    const apiKey = Deno.env.get("DROPSTAB_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ circulatingSupply: null, error: "DROPSTAB_API_KEY missing" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    const raw = String(coinName || "").trim();
    if (!raw) {
      return new Response(JSON.stringify({ circulatingSupply: null }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 1) Try direct slug
    const slug = slugifyLite(raw);
    let circ = await tryDetailed(apiKey, slug);
    if (circ != null) {
      return new Response(JSON.stringify({ circulatingSupply: circ, via: "detailed_slug", slug }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
        status: 200,
      });
    }

    // 2) Fetch list for lookup
    const r2 = await fetch("https://public-api.dropstab.com/api/v1/coins?currency=USD&rankFrom=1&rankTo=5000", {
      headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
    });

    if (r2.ok) {
      const j2 = await r2.json();
      const list = Array.isArray(j2?.data) ? j2.data : [];

      const upper = raw.toUpperCase();
      const lower = raw.toLowerCase();
      const sym = normSymbol(raw);

      // 2a) exact match priority
      let hit =
        list.find((c: any) => String(c?.symbol || "").toUpperCase() === upper) ||
        list.find((c: any) => normSymbol(String(c?.symbol || "")) === sym) ||
        list.find((c: any) => String(c?.slug || "").toLowerCase() === lower) ||
        list.find((c: any) => String(c?.name || "").toLowerCase() === lower);

      // 2b) partial match fallback (helps for cases like BTR where slug/name differ)
      if (!hit) {
        const lowerNoSpace = lower.replace(/\s+/g, "");
        hit =
          list.find((c: any) => normSymbol(String(c?.symbol || "")).includes(sym) && sym.length >= 2) ||
          list.find((c: any) => String(c?.slug || "").toLowerCase().includes(lowerNoSpace) && lowerNoSpace.length >= 2) ||
          list.find((c: any) => String(c?.name || "").toLowerCase().includes(lower) && lower.length >= 2);
      }

      const foundSlug = hit?.slug ? String(hit.slug) : null;

      if (foundSlug) {
        circ = await tryDetailed(apiKey, foundSlug);
        return new Response(
          JSON.stringify({
            circulatingSupply: circ,
            via: "coins_lookup",
            slug: foundSlug,
            matched: {
              symbol: hit?.symbol ?? null,
              name: hit?.name ?? null,
              slug: hit?.slug ?? null,
            },
          }),
          {
            headers: { ...corsHeaders, "content-type": "application/json" },
            status: 200,
          },
        );
      }
    }

    return new Response(JSON.stringify({ circulatingSupply: null, via: "not_found", slug }), {
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