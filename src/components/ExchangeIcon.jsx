import { useState } from 'react'

// Іконка біржі: ЛОКАЛЬНИЙ файл із /public/exchanges + фолбек-коло з літерою.
//
// Чому локально, а не через favicon-сервіс Google: заміряно на живій сторінці —
// із 21 запиту до google.com/s2/favicons провалилось 12. Сервіс ріже масові
// звернення, тому частина бірж показувала логотип, а частина — літеру-заглушку,
// і сітка виглядала зламаною. Локальні файли — 16 КБ на всі вісім, нуль
// зовнішніх запитів, імунітет до блокувальників реклами.
const EXCHANGES = {
  binance: { icon: '/exchanges/binance.png', color: '#F0B90B', label: 'Binance' },
  bybit: { icon: '/exchanges/bybit.png', color: '#F7A600', label: 'Bybit' },
  okx: { icon: '/exchanges/okx.png', color: '#334155', label: 'OKX' },
  bitget: { icon: '/exchanges/bitget.png', color: '#00F0FF', label: 'Bitget' },
  gate: { icon: '/exchanges/gate.png', color: '#2354E6', label: 'Gate' },
  kucoin: { icon: '/exchanges/kucoin.png', color: '#24AE8F', label: 'KuCoin' },
  mexc: { icon: '/exchanges/mexc.png', color: '#1972E2', label: 'MEXC' },
  bingx: { icon: '/exchanges/bingx.png', color: '#2A54FF', label: 'BingX' },
}

export function exchangeMeta(ex) {
  const key = String(ex || '').toLowerCase()
  return EXCHANGES[key] || { icon: null, color: '#64748b', label: ex || '?' }
}

/**
 * `tile` — світла підкладка під іконку.
 *
 * Навіщо: логотипи бірж намальовані під різний фон і без підкладки половина
 * з них зникає. Заміряні випадки: темний квадрат Bybit зливався з темною
 * карткою, а жовтий ромб Binance ставав невидимим на жовтому активному чіпі.
 * Підкладка робить будь-який логотип читабельним і виглядає як плитка застосунку.
 */
export default function ExchangeIcon({ exchange, size = 20, className = '', tile = false }) {
  const [failed, setFailed] = useState(false)
  const meta = exchangeMeta(exchange)

  const inner = !meta.icon || failed ? (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: meta.color, fontSize: size * 0.55 }}
      aria-label={meta.label}
    >
      {meta.label.slice(0, 1)}
    </span>
  ) : (
    <img
      src={meta.icon}
      width={size}
      height={size}
      alt={meta.label}
      className="rounded-[3px]"
      style={{ width: size, height: size, display: 'block' }}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )

  if (!tile) return <span className={`inline-flex ${className}`}>{inner}</span>

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md bg-white shrink-0 ${className}`}
      style={{ padding: Math.max(2, Math.round(size * 0.12)) }}
    >
      {inner}
    </span>
  )
}
