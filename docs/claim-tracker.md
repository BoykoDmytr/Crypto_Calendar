# Community Claim Tracker (`/claims`)

An on-chain–verified calendar of **community token claims** for MEXC/BingX-futures
tokens. Unlike aggregators that trust announcements, it verifies on-chain whether each
distribution actually happened: exact start time (UTC), how many wallets claimed, and
how much was distributed.

> Core distinction: **community CLAIM ≠ vesting UNLOCK.** A claim = end-users actively
> pull tokens from a distributor contract (tx spike, thousands of wallets). A vesting
> unlock = tokens move to foundation/insider wallets on a schedule (no user action).
> The `is_community_claim` flag filters the second kind out (VANA, ME are kept as
> verified-excluded examples).

## Pieces

| Piece | Path |
|---|---|
| Page (route `/claims`) | `src/pages/Claims.jsx` + `src/pages/Claims.css` |
| Data layer (read) | `src/lib/claimsApi.js` |
| Schema + seed | `supabase/migrations/20260617120*_claim_*.sql` |
| On-chain watcher (write) | `api/cron/claim-watcher.js` (Vercel cron, every 5 min) |

## Data model (`claim_*` tables, additive)

- `claim_tokens` — registry; `status` ∈ candidate/tracked/excluded, `is_community_claim`.
- `claim_token_chains` — a token can live on several chains (SOSO: ETH+Base+ValueChain);
  holds `explorer_api` (Blockscout) and `token_address` (null = native gas coin).
- `claim_distributors` — the contracts that send tokens to claimers; `watch=true` rows
  are polled by the watcher.
- `claim_events` — the state machine `announced → verified → completed / late`, one row
  per wave, deduped by `dedup_key = SYMBOL:YYYY-MM`.
- `claim_event_sources` — evidence per event (on-chain tx/address links).

RLS: anon can `SELECT` all five (the frontend reads with the public anon key). Writes
happen only through the watcher using the **service-role** key, which bypasses RLS.

## The watcher (deterministic core, no AI)

Per cron tick, for each watched distributor:
1. **Pool math** via Blockscout etherscan-style API — `pool = Σ funding IN`,
   `claimed = pool − balance`, `pct = claimed/pool`.
2. **Timing** — first OUT transfer after funding = mass-claim start (`actual_start_utc`,
   `first_tx_hash`); last OUT within 72h ⇒ still `verified` (live), else `completed`.
3. **Upsert** the latest wave's `claim_events` row by `dedup_key`, attach an on-chain
   `claim_event_sources` link, and **alert Telegram** on a new wave / first claim / going live.

Native-coin distributors (e.g. SOSO on ValueChain) use a lighter balance-only path.

### Env vars
- `SUPABASE_URL` (or `VITE_SUPABASE_URL`) + `SUPABASE_SERVICE_ROLE_KEY` — required.
- `CLAIM_TG_BOT_TOKEN` / `CLAIM_TG_CHAT_ID` — optional; falls back to
  `TELEGRAM_ADMIN_BOT_TOKEN` / `ADMIN_TG_CHAT_ID`.

Manual run (local): `curl https://<deployment>/api/cron/claim-watcher`.

## Onboarding a new token

Use the `claim-tracker` Claude skill (on-chain verification methodology) to identify the
token, find its distributor(s), and verify stats, then add rows to `claim_tokens` /
`claim_token_chains` / `claim_distributors` (set `watch=true` on the live distributor).
The watcher picks it up on the next tick. Always verify the **contract address** (symbol
collisions are common) and confirm it's a real community claim, not a vesting unlock.
