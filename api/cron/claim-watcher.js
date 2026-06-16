/* eslint-env node */
/* global process */

// ============================================================
// Community Claim Tracker — on-chain watcher (Vercel cron).
// The deterministic core: no AI. Every ~5 min it polls every watched
// distributor via Blockscout, does pool math (pool = sum funding IN;
// claimed = pool - balance), detects the first/mass claim of the latest
// wave, upserts claim_events (dedup_key = SYMBOL:YYYY-MM), attaches an
// on-chain source link, and pings Telegram on new fundings / first claims.
//
// Env (Vercel project settings):
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY  [required]
//   TELEGRAM_ADMIN_BOT_TOKEN + ADMIN_TG_CHAT_ID                      [optional alerts]
//   (override alert target with CLAIM_TG_BOT_TOKEN / CLAIM_TG_CHAT_ID)
// No Blockscout/CoinGecko key needed.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import dns from "node:dns";
import { Agent } from "undici";

// Vercel fra1 → api.telegram.org over IPv6 frequently hangs; pin IPv4 for TG.
dns.setDefaultResultOrder("ipv4first");
const tgAgent = new Agent({ connect: { family: 4 } });

const HTTP_TIMEOUT_MS = 12_000;
const LIVE_WINDOW_MS = 72 * 3600 * 1000; // out-tx within 72h => still "live"

const lc = (s) => String(s || "").toLowerCase();

async function jget(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function tgSend(token, chatId, text) {
  if (!token || !chatId) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
      dispatcher: tgAgent,
    });
  } catch (err) {
    console.error("[claim-watcher] telegram send failed:", err?.message || err);
  } finally {
    clearTimeout(timer);
  }
}

const apiBase = (explorerApi) => String(explorerApi).replace(/\/+$/, "");
const toUnits = (raw, decimals) => {
  if (raw == null) return null;
  const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 18;
  return Number(raw) / 10 ** d;
};
const monthKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const txUrlFor = (explorerApi, hash) =>
  `${apiBase(explorerApi).replace(/\/api$/, "")}/tx/${hash}`;
const addrUrlFor = (explorerApi, addr) =>
  `${apiBase(explorerApi).replace(/\/api$/, "")}/address/${addr}`;

// ---- ERC-20 pool math + timing via etherscan-compatible Blockscout API ----
async function statsErc20(explorerApi, dist, token) {
  const base = apiBase(explorerApi);
  // asc page: funding tx(s) + first claims; desc page: latest claims.
  const [asc, desc, bal] = await Promise.all([
    jget(`${base}?module=account&action=tokentx&address=${dist}&contractaddress=${token}&sort=asc&page=1&offset=200`).catch(() => null),
    jget(`${base}?module=account&action=tokentx&address=${dist}&contractaddress=${token}&sort=desc&page=1&offset=50`).catch(() => null),
    jget(`${base}?module=account&action=tokenbalance&contractaddress=${token}&address=${dist}`).catch(() => null),
  ]);

  const ascRows = Array.isArray(asc?.result) ? asc.result : [];
  const descRows = Array.isArray(desc?.result) ? desc.result : [];
  if (!ascRows.length && !descRows.length) return null;

  const decimals = Number(ascRows[0]?.tokenDecimal ?? descRows[0]?.tokenDecimal ?? 18);

  // pool = sum of incoming (funding) transfers
  let poolRaw = 0n;
  for (const t of ascRows) {
    if (lc(t.to) === lc(dist)) {
      try { poolRaw += BigInt(t.value); } catch { /* skip */ }
    }
  }
  const pool = poolRaw > 0n ? toUnits(poolRaw.toString(), decimals) : null;

  const balanceRaw = bal?.result ?? "0";
  const balance = toUnits(balanceRaw, decimals) ?? 0;
  const claimed = pool != null ? Math.max(0, pool - balance) : null;
  const pct = pool ? Math.max(0, Math.min(100, (claimed / pool) * 100)) : null;

  // first outgoing claim (mass start) = first OUT after funding, from asc page
  let firstOut = null;
  for (const t of ascRows) {
    if (lc(t.from) === lc(dist)) {
      firstOut = { ts: new Date(Number(t.timeStamp) * 1000), hash: t.hash };
      break;
    }
  }
  // last outgoing claim from desc page
  let lastOutTs = null;
  for (const t of descRows) {
    if (lc(t.from) === lc(dist)) {
      lastOutTs = new Date(Number(t.timeStamp) * 1000);
      break;
    }
  }

  // claims_count (best effort): counters minus inbound funding count
  let claimsCount = null;
  try {
    const counters = await jget(`${base}/v2/addresses/${dist}/counters`);
    const tt = Number(counters?.token_transfers_count);
    const inCount = ascRows.filter((t) => lc(t.to) === lc(dist)).length;
    if (Number.isFinite(tt) && tt > 0) claimsCount = Math.max(0, tt - inCount);
  } catch { /* counters often 0 on app-chains — leave null */ }

  return { pool, claimed, pct, firstOut, lastOutTs, claimsCount };
}

// ---- native-coin distributor (token = gas of its own chain): balance only ----
async function statsNative(explorerApi, dist) {
  const base = apiBase(explorerApi);
  try {
    const a = await jget(`${base}/v2/addresses/${dist}`);
    const balance = a?.coin_balance != null ? toUnits(a.coin_balance, 18) : null;
    return { pool: null, claimed: null, pct: null, firstOut: null, lastOutTs: null, claimsCount: null, balance };
  } catch {
    return null;
  }
}

function deriveStatus(pct, lastOutTs) {
  if (pct != null && pct >= 99) return "completed";
  if (lastOutTs && Date.now() - lastOutTs.getTime() < LIVE_WINDOW_MS) return "verified";
  if (pct != null) return "completed";
  return "announced";
}

export async function run() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  const botToken = process.env.CLAIM_TG_BOT_TOKEN || process.env.TELEGRAM_ADMIN_BOT_TOKEN;
  const chatId = process.env.CLAIM_TG_CHAT_ID || process.env.ADMIN_TG_CHAT_ID;

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // watched distributors + their token symbol
  const { data: dists, error: distErr } = await supabase
    .from("claim_distributors")
    .select("id, token_id, chain, address, verified_name, role, watch, claim_tokens(symbol, name)")
    .eq("watch", true);
  if (distErr) throw distErr;

  // explorer_api + token_address per (token_id, chain)
  const { data: chains, error: chainErr } = await supabase
    .from("claim_token_chains")
    .select("token_id, chain, token_address, explorer_api");
  if (chainErr) throw chainErr;
  const chainMap = new Map();
  for (const c of chains || []) chainMap.set(`${c.token_id}:${c.chain}`, c);

  const summary = { checked: 0, updated: 0, created: 0, alerts: 0, errors: [] };

  for (const d of dists || []) {
    summary.checked += 1;
    try {
      const ch = chainMap.get(`${d.token_id}:${d.chain}`);
      if (!ch?.explorer_api) continue;
      const symbol = d.claim_tokens?.symbol || "?";
      const isNative = !ch.token_address;

      const s = isNative
        ? await statsNative(ch.explorer_api, d.address)
        : await statsErc20(ch.explorer_api, ch.token_address, d.address);
      if (!s) continue;

      // identify the latest wave: month of last/first out tx, else current month
      const refDate = s.lastOutTs || s.firstOut?.ts || new Date();
      const dedupKey = `${symbol}:${monthKey(refDate)}`;
      const status = deriveStatus(s.pct, s.lastOutTs);

      const { data: existing } = await supabase
        .from("claim_events")
        .select("id, label, status, first_tx_hash, pct_claimed")
        .eq("dedup_key", dedupKey)
        .maybeSingle();

      const patch = {
        token_id: d.token_id,
        distributor_id: d.id,
        chain: d.chain,
        status,
        amount_pool: s.pool,
        amount_claimed: s.claimed,
        pct_claimed: s.pct != null ? Number(s.pct.toFixed(2)) : null,
        claims_count: s.claimsCount,
        updated_at: new Date().toISOString(),
      };
      if (s.firstOut) {
        patch.actual_start_utc = s.firstOut.ts.toISOString();
        patch.first_tx_hash = s.firstOut.hash;
      }

      let eventId;
      let isNew = false;
      if (existing) {
        eventId = existing.id;
        // never clobber a curated label/promised date — only refresh stats
        if (existing.label) delete patch.label;
        const { error } = await supabase.from("claim_events").update(patch).eq("id", existing.id);
        if (error) throw error;
        summary.updated += 1;
      } else {
        patch.label = `${d.role ? d.role.toUpperCase() : "Claim"} ${monthKey(refDate)}`;
        patch.dedup_key = dedupKey;
        const { data: ins, error } = await supabase
          .from("claim_events")
          .insert(patch)
          .select("id")
          .single();
        if (error) throw error;
        eventId = ins.id;
        isNew = true;
        summary.created += 1;
      }

      // ensure an on-chain source link exists for this event
      if (eventId) {
        const url = s.firstOut
          ? txUrlFor(ch.explorer_api, s.firstOut.hash)
          : addrUrlFor(ch.explorer_api, d.address);
        const { data: src } = await supabase
          .from("claim_event_sources")
          .select("id")
          .eq("event_id", eventId)
          .eq("url", url)
          .maybeSingle();
        if (!src) {
          await supabase.from("claim_event_sources").insert({
            event_id: eventId,
            source_type: "onchain",
            url,
            detail: d.verified_name || d.role || "distributor",
          });
        }
      }

      // alerts: brand-new wave, or first claim just detected, or went live
      const becameLive = existing && existing.status !== "verified" && status === "verified";
      const firstClaimNow = existing && !existing.first_tx_hash && s.firstOut;
      if ((isNew && (s.firstOut || s.pool)) || becameLive || firstClaimNow) {
        const pctTxt = s.pct != null ? `${s.pct.toFixed(1)}%` : "—";
        const amtTxt = s.claimed != null && s.pool != null
          ? ` (${fmt(s.claimed)}/${fmt(s.pool)})`
          : "";
        const when = s.firstOut ? `\nСтарт: ${s.firstOut.ts.toISOString()}` : "";
        const link = s.firstOut ? `\n${txUrlFor(ch.explorer_api, s.firstOut.hash)}` : "";
        await tgSend(
          botToken,
          chatId,
          `🟢 <b>${symbol}</b> — клейм активний на ${d.chain}\n${pctTxt} роздано${amtTxt}${when}${link}`,
        );
        summary.alerts += 1;
      }
    } catch (err) {
      summary.errors.push({ distributor: d.address, message: err?.message || String(err) });
    }
  }

  return summary;
}

function fmt(n) {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export default async function handler(_req, res) {
  try {
    const summary = await run();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[claim-watcher] fatal", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
