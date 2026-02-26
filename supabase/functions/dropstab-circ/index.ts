// @ts-nocheck
// supabase/functions/dropstab-circ/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function toDropstabSlug(name: string) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const { coinName } = await req.json();
    const apiKey = Deno.env.get("DROPSTAB_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "DROPSTAB_API_KEY missing" }), { status: 500 });

    const slug = toDropstabSlug(String(coinName || ""));
    if (!slug) return new Response(JSON.stringify({ circulatingSupply: null }), { status: 200 });

    const r = await fetch(`https://public-api.dropstab.com/api/v1/coins/detailed/${slug}`, {
      headers: {
        accept: "application/json",
        "x-dropstab-api-key": apiKey,
      },
    });

    if (!r.ok) {
      return new Response(JSON.stringify({ circulatingSupply: null, status: r.status }), { status: 200 });
    }

    const json = await r.json();
    const circ = json?.data?.circulatingSupply;
    return new Response(JSON.stringify({ circulatingSupply: typeof circ === "number" ? circ : null }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});