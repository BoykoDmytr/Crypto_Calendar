// @ts-nocheck
// supabase/functions/dropstab-circ/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function slugifyLite(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const { coinName } = await req.json();
  const apiKey = Deno.env.get("DROPSTAB_API_KEY");

  // ✅ важливо: повертаємо 200, щоб не було зайвих ретраїв, але даємо error в JSON
  if (!apiKey) {
    return new Response(JSON.stringify({ circulatingSupply: null, error: "DROPSTAB_API_KEY missing" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }

  const raw = String(coinName || "").trim();
  if (!raw) {
    return new Response(JSON.stringify({ circulatingSupply: null }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }

  // 1) спроба як slug
  const slug = slugifyLite(raw);
  let circ = await tryDetailed(apiKey, slug);
  if (circ != null) {
    return new Response(JSON.stringify({ circulatingSupply: circ, via: "detailed_slug", slug }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }

  // 2) fallback по symbol / name / slug (тягнемо топ 5000)
  const r2 = await fetch("https://public-api.dropstab.com/api/v1/coins?currency=USD&rankFrom=1&rankTo=5000", {
    headers: { accept: "application/json", "x-dropstab-api-key": apiKey },
  });

  if (r2.ok) {
    const j2 = await r2.json();
    const list = Array.isArray(j2?.data) ? j2.data : [];
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();

    const hit =
      list.find((c: any) => String(c?.symbol || "").toUpperCase() === upper) ||
      list.find((c: any) => String(c?.name || "").toLowerCase() === lower) ||
      list.find((c: any) => String(c?.slug || "").toLowerCase() === lower);

    const foundSlug = hit?.slug ? String(hit.slug) : null;

    if (foundSlug) {
      circ = await tryDetailed(apiKey, foundSlug);
      return new Response(JSON.stringify({ circulatingSupply: circ, via: "coins_lookup", slug: foundSlug }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
  }

  return new Response(JSON.stringify({ circulatingSupply: null, via: "not_found", slug }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
});