# Crypto Events Calendar

This project is a Vite + React single-page application that powers the Crypto Events Calendar. It now includes an on-chain airdrop progress dashboard that can be enabled through environment configuration.

## Getting started

```bash
npm install
npm run dev
```

## Airdrop tracker configuration

Set the following environment variables (for example in a `.env.local` file) to enable `/airdrop` in the navigation. The tracker calls `eth_getLogs` on your RPC endpoint, aggregates the claimed total, and keeps a local cache in the browser.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_AIRDROP_ENABLED` | No (default `true`) | Set to `false` to hide the tracker. |
| `VITE_AIRDROP_NAME` | No | UI title for the campaign. |
| `VITE_AIRDROP_DESCRIPTION` | No | Optional subtitle text. |
| `VITE_AIRDROP_TOKEN_SYMBOL` | No | Token ticker shown next to values (default `TOKEN`). |
| `VITE_AIRDROP_TOKEN_DECIMALS` | No | Token decimals (default `18`). |
| `VITE_AIRDROP_TOTAL_ALLOCATION` | **Yes** | Total allocation for this drop in human-readable units (e.g. `1000000`). |
| `VITE_AIRDROP_RPC_URL` | **Yes** | HTTPS JSON-RPC endpoint used for log queries. |
| `VITE_AIRDROP_RPC_HEADERS` | No | JSON object with additional headers (e.g. `{"Authorization":"Bearer ..."}`). |
| `VITE_AIRDROP_CONTRACT` | **Yes** | Airdrop/distributor contract address. |
| `VITE_AIRDROP_DISTRIBUTOR` | No | Distributor wallet; when provided and only `topic0` is set we automatically filter topic1 by this address. |
| `VITE_AIRDROP_TOPIC0` | **Yes** | Topic0 of the claim event (Keccak hash). |
| `VITE_AIRDROP_TOPIC1-3` | No | Optional topic filters. Use `address:0xabc...` to auto-pad an address or `null`/`*` for a wildcard. |
| `VITE_AIRDROP_CLAIMER_TOPIC_INDEX` | No | Which topic holds the claimer address (default `1`). |
| `VITE_AIRDROP_AMOUNT_DATA_INDEX` | No | Which 32-byte slot in `data` contains the amount (default `0`). |
| `VITE_AIRDROP_START_BLOCK` | No | Block number where the drop started (default `0`). |
| `VITE_AIRDROP_CONFIRMATION_BLOCKS` | No | Confirmations to wait before processing logs (default `5`). |
| `VITE_AIRDROP_REORG_BUFFER` | No | How many blocks to rescan each poll for reorg safety (default `12`). |
| `VITE_AIRDROP_BLOCK_CHUNK` | No | Block span per `eth_getLogs` call (default `2000`). Automatically halves on "too many results". |
| `VITE_AIRDROP_HISTORY_LIMIT` | No | Number of historical snapshots to keep client-side (default `720`). |
| `VITE_AIRDROP_REFRESH_INTERVAL` | No | Polling interval in milliseconds (minimum `30000`, default `60000`). |
| `VITE_AIRDROP_RPC_TIMEOUT` | No | RPC timeout in milliseconds (default `15000`). |
| `VITE_AIRDROP_FETCH_BLOCK_TIMESTAMPS` | No | Set to `true` to enrich recent claims with block timestamps. |
| `VITE_AIRDROP_EXPLORER_BASE_URL` | No | Base URL for the chain explorer (e.g. `https://etherscan.io`). |
| `VITE_AIRDROP_ID` | No | Cache key identifier (default `default`). |

### How it works

1. Every refresh cycle the app queries `eth_blockNumber`, determines a safe block range (confirmation delay + reorg buffer), and pulls `eth_getLogs` in chunks.
2. It extracts the claim amount from the event `data`, adds the delta to the cached total, and stores a snapshot (claimed, remaining, percents) in localStorage.
3. The dashboard visualises the percentage claimed over time and lists the latest detected claim transactions. Use the “Reset cache” button if you want to rescan from scratch.

### Notes

- The tracker is browser-only. For production setups consider running a backend cron that writes snapshots to a database and expose those via API.
- When topic filters are omitted the tracker ingests every log emitted by the contract. If your event exposes multiple indexed addresses provide additional topics to narrow the scope.
- For ERC-20 `Transfer`-based drops set `VITE_AIRDROP_TOPIC0` to the `Transfer` signature and `VITE_AIRDROP_AMOUNT_DATA_INDEX=0` (the value is stored in the event data).

## Development scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Create a production build. |
| `npm run preview` | Preview the production build. |
| `npm run lint` | Run ESLint. |
| `npm run sync:telegram` | Parse Telegram channel posts and push them to `auto_events_pending`. |

## Telegram automation

The project ships with a small ingestion script that collects new posts from a set of public
Telegram channels and stores structured events in the `auto_events_pending` table for moderation.
It relies on the Telegram Bot API, so you have to create a bot, add it to each channel as an
administrator (or at least give it permission to read posts), and keep the bot token handy.

### Required environment variables

Set the following variables before running `npm run sync:telegram`:

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | **Yes** | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Service role key used to insert rows into `auto_events_pending`. |
| `TELEGRAM_BOT_TOKEN` | **Yes** | Bot token used to call `getUpdates`. The bot must be a member of every parsed channel. |
| `TELEGRAM_STATE_FILE` | No | Path to a JSON file with the last processed update id (default `.telegram-updates.json`). |

You can export the variables in your shell or rely on Node's `--env-file` flag, e.g.:

```bash
node --env-file=.env.local scripts/telegram-sync.js
```

Every execution fetches new `channel_post` updates, converts recognised posts into events, and
skips entries that already exist in `auto_events_pending` (matching by title, start date, and link).
If the script cannot parse a date, it stores the publication timestamp and leaves a note in the
description so moderators can adjust the row manually via the admin panel..