import { useRef, useState } from 'react'

// Нагорода з цінником: наведи на «1 000 ALIGN» — побачиш «≈ $
// Ціна тягнеться ЛИШЕ на ховер і кешується, тож на рендер — нуль запитів.
// Джерела по черзі: Binance → MEXC → Gate (усі три віддають CORS для фронта).

const cache = new Map() // symbol -> { price, at }
const TTL = 60_000
const STABLES = new Set(['USDT', 'USDC', 'USD', 'USD1', 'GUSD', 'USDG', 'USDX', 'BUSD'])

async function fetchPrice(symbol) {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < TTL) return hit.price
  let price = null
  const jobs = [
    async () => {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`, { signal: AbortSignal.timeout(4000) })
      const j = await r.json()
      return j && j.price ? Number(j.price) : null
    },
    async () => {
      const r = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}USDT`, { signal: AbortSignal.timeout(4000) })
      const j = await r.json()
      return j && j.price ? Number(j.price) : null
    },
    async () => {
      const r = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}_USDT`, { signal: AbortSignal.timeout(4000) })
      const j = await r.json()
      return Array.isArray(j) && j[0] && j[0].last ? Number(j[0].last) : null
    },
  ]
  for (const job of jobs) {
    try {
      price = await job()
      if (Number.isFinite(price) && price > 0) break
      price = null
    } catch { price = null }
  }
  cache.set(symbol, { price, at: Date.now() })
  return price
}

// «1 000 ALIGN», «250 000 ALIGN», «40 USDC» → { amount, symbol }
function parseReward(text) {
  const m = String(text).match(/([\d][\d\s.,]*)\s*([A-Z]{2,10})\b/)
  if (!m) return null
  const amount = Number(m[1].replace(/[\s,]/g, ''))
  const symbol = m[2]
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { amount, symbol }
}

const fmtUsd = (v) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2)}`

export default function RewardPrice({ text }) {
  const [tip, setTip] = useState(null) // null | 'loading' | рядок
  const parsed = useRef(parseReward(text)).current

  if (!parsed) return <>{text}</>
  if (STABLES.has(parsed.symbol)) return <>{text}</>

  async function onEnter() {
    if (tip && tip !== 'loading') return
    setTip('loading')
    const price = await fetchPrice(parsed.symbol)
    setTip(price ? `≈ ${fmtUsd(parsed.amount * price)}` : 'ціна недоступна')
  }

  return (
    <span className="relative inline-block" onMouseEnter={onEnter} onTouchStart={onEnter}>
      <span className="border-b border-dotted border-gray-400 cursor-help">{text}</span>
      {tip && (
        <span className="absolute left-0 -top-7 z-10 whitespace-nowrap text-xs px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 shadow">
          {tip === 'loading' ? '…' : tip}
        </span>
      )}
    </span>
  )
}
