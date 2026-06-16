# Crypto Events Calendar

Календар майбутніх крипто-подій українською: лістинги (TGE), аірдропи, альфа та інші ключові івенти. Спільнотний фід, який модерується вручну і доповнюється автоматичною інжестією з Telegram.

🌐 Продакшн: [cryptoeventscalendar.com](https://cryptoeventscalendar.com)

## Особливості

- **Місячний календар** з нескінченною навігацією, кешуванням за місяцем і поділом подій по дням у часових поясах `UTC` / `Europe/Kyiv`.
- **Стрічка івентів** із фільтрами за типом, реакціями (👍/👎) та CTA на Telegram-канал.
- **Картка події** з лінками на біржі, кількістю токенів, лінком на ціну, інформацією про MCAP та `% обігу`.
- **Форма подачі та редагування** події (`/add`, `/suggest/:id`) із чергою модерації в Supabase.
- **Адмін-панель** для апруву / реджекту подій із чернеткової черги.
- **Airdrop tracker** (`/airdrop`) — прогрес клеймів конкретної кампанії на основі on-chain логів через RPC.
- **Community Claim Tracker** (`/claims`) — календар клеймів спільноти (MEXC/BingX токени), де кожен розлок **верифікований on-chain** через Blockscout: точний час старту (UTC), скільки гаманців заклеймили, скільки роздано. On-chain watcher (Vercel Cron) оновлює дані сам. Деталі: [`docs/claim-tracker.md`](docs/claim-tracker.md).
- **Price reaction** — автоматичний джоб, який рахує реакцію ціни після TGE й рендерить графіки на сторінці статистики.
- **Інжестія з Telegram** — Vercel Cron щоп’ять хвилин підтягує пости з каналу у `auto_events_pending` та збагачує MCAP-дані з MEXC.
- **Темна тема за замовчуванням**, адаптивний UI під мобайл, Vercel Analytics + Speed Insights у проді.

## Стек

- **Фронтенд:** React 19, React Router 7, Vite 7, Tailwind CSS 3, Day.js
- **Бекенд / БД:** Supabase (Postgres, RLS, Edge Functions на Deno)
- **Serverless API:** Vercel Functions (`/api/*`) + Vercel Cron
- **Аналітика:** `@vercel/analytics`, `@vercel/speed-insights`
- **Інтеграції:** Telegram Bot API, MEXC, Binance, Dropstab (circulating supply)

## Маршрути

| Шлях | Сторінка | Опис |
| --- | --- | --- |
| `/` | `MonthCalendar` | Головна — місячний календар |
| `/events` | `Calendar` | Стрічка майбутніх та минулих подій |
| `/add` | `AddEvent` | Форма додавання івенту |
| `/suggest/:id` | `SuggestEdit` | Запропонувати правки до існуючої події |
| `/admin` | `Admin` | Модерація черги (закрита) |
| `/airdrop` | `AirdropTracker` | Прогрес клеймів аірдропу |
| `/claims` | `Claims` | On-chain верифікований календар клеймів спільноти |
| `/stats` | `Stats` | Реакція ціни після TGE |
| `/gifts` | `Gifts` | Архів розіграшів |

## Структура проєкту

```
.
├── api/                      # Vercel Serverless Functions
│   ├── cron/
│   │   ├── telegram-scrape.js   # cron */5 — підтяжка постів з Telegram
│   │   └── delete-old-events.js # cron 03:00 — прибирання старих подій
│   ├── sync/binance.js          # синк тикерів з Binance
│   └── mexc-ticker.js           # проксі до MEXC (maxDuration 10s, region fra1)
├── scripts/                  # Локальні / CI скрипти на Node
│   ├── telegram-sync.js
│   ├── price-reaction-job.js
│   ├── backfill-dropstab-slug.js
│   └── notify-admin-bot.js
├── src/
│   ├── pages/                # MonthCalendar, Calendar, AddEvent, Admin, …
│   ├── components/           # EventCard, EventForm, Navbar, ReactionChart, …
│   ├── hooks/                # useReactionsBatch та ін.
│   ├── lib/                  # supabase, api, statsApi
│   ├── utils/                # tokenAmount, dropstabCache, та ін.
│   └── config.js             # парсинг env (Supabase, Airdrop)
├── supabase/
│   ├── schema.sql            # довідкова схема БД
│   ├── migrations/           # SQL міграції
│   └── functions/            # Edge Functions (Deno)
│       ├── dropstab-circ/
│       └── price-reaction-cron/
├── public/                   # статичні ассети (іконки, OG-зображення)
├── vercel.json               # rewrites + crons + регіон
└── vite.config.js
```

## Швидкий старт

```bash
npm install
npm run dev
```

Дев-сервер запуститься на `http://localhost:5173`. SPA-рерайт у `vercel.json` віддає `index.html` на всі маршрути в проді.

### Скрипти

| Команда | Опис |
| --- | --- |
| `npm run dev` | Локальний дев-сервер Vite |
| `npm run build` | Прод-білд у `dist/` |
| `npm run preview` | Перегляд прод-білду |
| `npm run lint` | ESLint по всьому репо |
| `npm run sync:telegram` | Ручний запуск інжестії з Telegram |
| `npm run price:reaction` | Ручний запуск джобу price-reaction |

## Конфігурація

Створи `.env.local` у корені (для дев-режиму) або задай ті самі змінні у Vercel Project Settings.

### Supabase (обов'язкові)

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### Airdrop tracker (опційно)

Якщо хоча б одна з обов'язкових змінних відсутня, секція деградує до плейсхолдеру.

```env
VITE_AIRDROP_ENABLED=true
VITE_AIRDROP_ID=my-campaign
VITE_AIRDROP_NAME="My Airdrop"
VITE_AIRDROP_TOKEN_SYMBOL=TKN
VITE_AIRDROP_TOKEN_DECIMALS=18
VITE_AIRDROP_TOTAL_ALLOCATION=12500000

VITE_AIRDROP_RPC_URL=https://...
VITE_AIRDROP_RPC_HEADERS={"Authorization":"Bearer ..."}
VITE_AIRDROP_CONTRACT=0x...
VITE_AIRDROP_DISTRIBUTOR=0x...
VITE_AIRDROP_TOPIC0=0x...           # event signature
VITE_AIRDROP_TOPIC1=address:0x...   # опційно
VITE_AIRDROP_CLAIMER_TOPIC_INDEX=1
VITE_AIRDROP_AMOUNT_DATA_INDEX=0

VITE_AIRDROP_START_BLOCK=0
VITE_AIRDROP_CONFIRMATION_BLOCKS=5
VITE_AIRDROP_REORG_BUFFER=12
VITE_AIRDROP_BLOCK_CHUNK=2000
VITE_AIRDROP_HISTORY_LIMIT=720
VITE_AIRDROP_REFRESH_INTERVAL=60000
VITE_AIRDROP_RPC_TIMEOUT=15000
VITE_AIRDROP_FETCH_BLOCK_TIMESTAMPS=false
VITE_AIRDROP_EXPLORER_BASE_URL=https://etherscan.io
```

### Інжестія з Telegram + MCAP (для скриптів і Vercel Cron)

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_SOURCE_CHANNEL=@cryptohornettg
ADMIN_BOT_CHAT_ID=...
```

> Секрети тримай у `.env.local` (для дев) або в env Vercel (для прод). Не комітити.

## Деплой

Сайт розгорнуто на **Vercel** (регіон `fra1`).

`vercel.json` налаштовує:
- SPA-рерайт `/(.*) → /index.html`
- `maxDuration: 10s` для `api/mexc-ticker.js`
- крони:
  - `*/5 * * * *` — `/api/cron/telegram-scrape`
  - `0 3 * * *` — `/api/cron/delete-old-events`
  - `*/5 * * * *` — `/api/cron/claim-watcher` (on-chain клейм-watcher → `claim_events` + Telegram)

Supabase Edge Functions (`dropstab-circ`, `price-reaction-cron`) деплояться окремо через Supabase CLI:

```bash
supabase functions deploy dropstab-circ
supabase functions deploy price-reaction-cron
```

## Контриб'ютинг

PR-и вітаються. Будь ласка:
- тримай зміни сфокусованими;
- проганяй `npm run lint` перед пушем;
- для UI-змін додавай скриншоти / GIF до опису PR.

## Контакти

- Telegram канал: [@cryptohornettg](https://t.me/cryptohornettg)
- Owner: [@romasya06](https://t.me/romasya06)
- Dev: [@BoychikTheBest](https://t.me/BoychikTheBest)
