import { supabase } from './supabase';

// Community Claim Tracker — read layer.
// Reads the claim_* tables (RLS allows anonymous SELECT). Writes are done
// only by the on-chain watcher with the service-role key (see api/cron/claim-watcher.js).

const TOKEN_SELECT = `
  id, symbol, name, project, coingecko_slug, is_community_claim, cadence, status, notes,
  claim_token_chains ( chain, token_address, explorer_api, is_primary ),
  claim_distributors ( address, verified_name, role, chain, watch ),
  claim_events (
    id, label, chain, status, promised_date, actual_start_utc, first_tx_hash,
    claims_count, amount_pool, amount_claimed, pct_claimed, next_predicted, dedup_key, updated_at,
    claim_event_sources ( source_type, url, detail )
  )
`;

// Best timestamp to sort/display an event by (on-chain truth first, paper date fallback).
export function eventDate(ev) {
  if (ev?.actual_start_utc) return new Date(ev.actual_start_utc);
  if (ev?.promised_date) return new Date(`${ev.promised_date}T00:00:00Z`);
  return null;
}

function withSortedEvents(token) {
  const events = [...(token.claim_events || [])].sort((a, b) => {
    const da = eventDate(a);
    const db = eventDate(b);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0); // newest first
  });
  return { ...token, claim_events: events };
}

// Tracked, real community-claim tokens (default tab set).
export async function fetchTrackedTokens() {
  const { data, error } = await supabase
    .from('claim_tokens')
    .select(TOKEN_SELECT)
    .eq('status', 'tracked')
    .order('symbol', { ascending: true });
  if (error) throw error;
  return (data || []).map(withSortedEvents);
}

// Verified-and-EXCLUDED tokens (insider/vesting unlocks) — kept as honest
// negative examples so the calendar never silently over-reports.
export async function fetchExcludedTokens() {
  const { data, error } = await supabase
    .from('claim_tokens')
    .select('id, symbol, name, project, notes')
    .eq('status', 'excluded')
    .order('symbol', { ascending: true });
  if (error) throw error;
  return data || [];
}
