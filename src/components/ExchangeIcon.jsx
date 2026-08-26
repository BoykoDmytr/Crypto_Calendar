import { useState } from 'react'

// Іконка біржі: favicon з Google s2 (надійний CDN) + фолбек-коло з літерою
// у бренд-кольорі, якщо favicon не завантажився.
const EXCHANGES = {
  binance: { domain: 'binance.com', color: '#F0B90B', label: 'Binance' },
  bybit: { domain: 'bybit.com', color: '#F7A600', label: 'Bybit' },
  okx: { domain: 'okx.com', color: '#334155', label: 'OKX' },
  bitget: { domain: 'bitget.com', color: '#00F0FF', label: 'Bitget' },
  gate: { domain: 'gate.com', color: '#2354E6', label: 'Gate' },
  kucoin: { domain: 'kucoin.com', color: '#24AE8F', label: 'KuCoin' },
  mexc: { domain: 'mexc.com', color: '#1972E2', label: 'MEXC' },
  bingx: { domain: 'bingx.com', color: '#2A54FF', label: 'BingX' },
}

export function exchangeMeta(ex) {
  const key = String(ex || '').toLowerCase()
  return EXCHANGES[key] || { domain: null, color: '#64748b', label: ex || '?' }
}

export default function ExchangeIcon({ exchange, size = 20, className = '' }) {
  const [failed, setFailed] = useState(false)
  const meta = exchangeMeta(exchange)
  if (!meta.domain || failed) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full font-bold text-white ${className}`}
        style={{ width: size, height: size, background: meta.color, fontSize: size * 0.55 }}
        aria-label={meta.label}
      >
        {meta.label.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`}
      width={size}
      height={size}
      alt={meta.label}
      className={`rounded ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
