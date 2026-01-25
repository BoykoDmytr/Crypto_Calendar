# Crypto Calendar ⚡️

A fast, modern calendar for tracking crypto launches, listings, airdrops, and ecosystem updates. Built to keep the signal clean and the experience smooth.

## ✨ Highlights

- **Curated events** with clear dates and links
- **Airdrop progress dashboard** (optional)
- **Telegram ingestion pipeline** for moderated event discovery
- **Responsive UI** optimized for desktop and mobile

## 🧱 Tech stack

- Vite + React
- Tailwind CSS
- Supabase (storage + moderation flow)

## 🚀 Quick start

```bash
npm install
npm run dev
```

## ⚙️ Configuration (high‑level)

Use a `.env.local` file for optional features and integrations.

- **Airdrop dashboard**: enable/disable and point to your RPC provider.
- **Telegram ingestion**: supply Supabase credentials + a bot token.

> Tip: keep secrets in `.env.local` and never commit them.

## 🧪 Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview build |
| `npm run lint` | Lint the codebase |
| `npm run sync:telegram` | Pull Telegram posts into moderation queue |


## 🧭 Project structure

- `src/` — app UI + logic
- `public/` — static assets
- `scripts/` — automation (e.g., Telegram sync)
- `supabase/` — database helpers and config

## ✅ Contributing

PRs are welcome. Keep changes focused and include screenshots for UI updates when possible.

---

Made for builders who prefer clarity over noise.