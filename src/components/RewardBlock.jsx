import { useEffect, useState } from 'react'
import { splitReward, parseAmounts, formatUsd } from '../lib/rewardText'

// Блок «Нагорода» на картці /creators.
//
// Два рішення, які тут закріплені:
//  1) нагорода розбита на окремі рядки ДЕТЕРМІНОВАНО (див. lib/rewardText.js),
//     а не суцільним абзацом від ШІ;
//  2) долари показуються ОКРЕМИМ рядком унизу — як у календарі, — а не
//     спливаючою підказкою на ховер: підказка накривала сусідні рядки й «стрибала».

const TTL = 60_000
const cache = new Map() // SYMBOL -> { price, at }
const inflight = new Map() // SYMBOL -> Promise

// Джерела ціни. Питаємо паралельно й беремо перше валідне за пріоритетом —
// одна повільна біржа не тримає рядок.
// MEXC тут НЕМАЄ навмисно: заміряно з живого домену — api.mexc.com не віддає
// CORS для cryptoeventscalendar.com навіть на BTCUSDT, тобто це гарантовано
// провалений запит і червоний рядок у консолі на кожен символ.
// Binance CORS віддає, але тільки на успіх: для тікера, якого він не лістить,
// відповідь 400 приходить без заголовка — звідси Gate як другий обов'язковий.
async function loadPrice(symbol) {
  const jobs = [
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`, { signal: AbortSignal.timeout(6000) })
      .then((r) => r.json()).then((j) => (j && j.price ? Number(j.price) : null)),
    fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}_USDT`, { signal: AbortSignal.timeout(6000) })
      .then((r) => r.json()).then((j) => (Array.isArray(j) && j[0] && j[0].last ? Number(j[0].last) : null)),
  ]
  const settled = await Promise.allSettled(jobs)
  for (const s of settled) {
    const v = s.status === 'fulfilled' ? s.value : null
    if (Number.isFinite(v) && v > 0) return v
  }
  return null
}

function priceOf(symbol) {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.price)
  if (inflight.has(symbol)) return inflight.get(symbol)
  const p = loadPrice(symbol)
    .catch(() => null)
    .then((price) => {
      cache.set(symbol, { price, at: Date.now() })
      inflight.delete(symbol)
      return price
    })
  inflight.set(symbol, p)
  return p
}

function usePrices(symbols) {
  const key = symbols.join(',')
  const [state, setState] = useState({ prices: {}, ready: false })
  useEffect(() => {
    if (!key) { setState({ prices: {}, ready: true }); return }
    let alive = true
    setState({ prices: {}, ready: false })
    Promise.all(key.split(',').map((s) => priceOf(s).then((p) => [s, p])))
      .then((pairs) => alive && setState({ prices: Object.fromEntries(pairs), ready: true }))
    return () => { alive = false }
  }, [key])
  return state
}

const VISIBLE = 4

export default function RewardBlock({ reward, tiers, slots, accent = '#64748b' }) {
  const [open, setOpen] = useState(false)

  const lines = Array.isArray(tiers) && tiers.length ? tiers : splitReward(reward)
  // Головний рядок беремо з `reward` (там біржа пише сумарну цифру), а тіри
  // лишаються деталями. Якщо reward порожній — головним стає перший тір.
  const headlineRaw = (reward && splitReward(reward)[0]) || lines[0] || ''
  const headline = headlineRaw
  const detail = Array.isArray(tiers) && tiers.length && reward ? lines : lines.slice(1)
  const rest = open ? detail : detail.slice(0, VISIBLE)

  // Ціну рахуємо для сум із УСЬОГО тексту нагороди: і за пост, і за пул.
  const amounts = parseAmounts([reward, ...(Array.isArray(tiers) ? tiers : [])].join(' ; '))
  const { prices, ready } = usePrices([...new Set(amounts.map((a) => a.symbol))])
  const priced = amounts
    .map((a) => ({ ...a, usd: a.amount * (prices[a.symbol] ?? NaN) }))
    .filter((a) => Number.isFinite(a.usd) && a.usd > 0)
  // Поки ціна їде — тримаємо рядок на місці з «…», інакше картка підстрибує,
  // коли відповідь біржі приходить через секунду після рендера.
  const priceRow = ready ? priced : amounts.map((a) => ({ ...a, usd: null }))

  if (!headline) return null

  return (
    <section className="rounded-xl c-panel px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider c-faint">Нагорода</span>
        {slots != null && (
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-brand-600 text-white">
            {slots.toLocaleString('uk-UA')} місць
          </span>
        )}
      </div>

      {/* ІЄРАРХІЯ: перший рядок — головна цифра, за неї має чіплятись око.
          Решта деталей дрібніше й приглушено. Раніше всі рядки мали однакову
          вагу, і «$13 000» губилось серед умов. */}
      <p className="text-[15px] font-semibold leading-snug break-words c-strong">{headline}</p>

      {rest.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[13px] leading-snug c-muted">
          {rest.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[6px] w-1 h-1 rounded-full shrink-0" style={{ background: accent }} />
              <span className="min-w-0 break-words">{line}</span>
            </li>
          ))}
        </ul>
      )}

      {detail.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-[12px] font-medium text-brand-500 hover:underline"
        >
          {open ? 'згорнути' : `ще ${detail.length - VISIBLE} ▾`}
        </button>
      )}

      {priceRow.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ borderColor: 'var(--border)' }}>
          {priceRow.map((a) => (
            <span key={`${a.symbol}-${a.amount}`} className="whitespace-nowrap">
              <span className="font-semibold">{a.label}</span>
              <span className="ml-1.5 c-muted">≈ {a.usd == null ? '…' : formatUsd(a.usd)}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
