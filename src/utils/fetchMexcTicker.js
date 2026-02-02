// src/utils/fetchMexcTicker.js

const DEFAULT_TIMEOUT_MS = 10_000;

// ✅ ЄДИНЕ джерело на фронті — твій same-origin endpoint (без CORS)
const INTERNAL_PROXY_PATH = '/api/mexc-ticker';

function createAbortController(timeoutMs) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    controller,
    cleanup: () => clearTimeout(timerId),
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  const { controller, cleanup } = createAbortController(timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    cleanup();
  }
}

/**
 * ✅ Будує URL до твого API-проксі.
 * Очікується, що бекенд повертає JSON: { ok: true, price: number, ... }
 */
function buildProxyUrl(symbol, { market }) {
  const m = market === 'futures' ? 'futures' : 'spot';
  const params = new URLSearchParams({
    symbol: String(symbol || '').trim(),
    market: m,
  });

  // важливо: same-origin
  return `${INTERNAL_PROXY_PATH}?${params.toString()}`;
}

function parsePrice(data) {
  // Ми очікуємо { ok: true, price: <number> }
  // Але залишаємо кілька фолбеків на випадок змін.
  const candidates = [
    data?.price,
    data?.data?.price,
    data?.data?.lastPrice,
    data?.lastPrice,
    data?.fairPrice,
  ];

  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) return num;
  }

  return null;
}

/**
 * ✅ Отримати ціну MEXC для символу:
 * - spot: "BTCUSDT"
 * - futures: "BTC_USDT"
 *
 * На фронті запит іде ТІЛЬКИ на /api/mexc-ticker (без CORS).
 */
export async function fetchMexcTickerPrice(
  symbol,
  { timeoutMs = DEFAULT_TIMEOUT_MS, market = 'spot' } = {}
) {
  const url = buildProxyUrl(symbol, { market });

  try {
    const res = await fetchWithTimeout(url, timeoutMs);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Proxy status ${res.status}: ${body.slice(0, 200)}`);
    }

    const rawBody = await res.text();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (parseError) {
      throw new Error(
        `Invalid JSON from proxy: ${parseError.message}; body: ${rawBody.slice(0, 200)}`
      );
    }

    // якщо твій бекенд повертає ok=false — піднімаємо помилку
    if (data && data.ok === false) {
      const msg = data.error ? String(data.error) : 'Proxy returned ok=false';
      throw new Error(msg);
    }

    const price = parsePrice(data);

    if (price === null) {
      throw new Error('Invalid price payload from proxy');
    }

    return { price, source: 'internal-proxy' };
  } catch (error) {
    console.error('[MEXC] proxy fetch failed', error);
    throw error;
  }
}

/**
 * ✅ Для дебагу — які URL-и використовуються.
 */
export function buildMexcTickerUrl(symbol, { market = 'spot' } = {}) {
  const proxyUrl = buildProxyUrl(symbol, { market });

  return {
    proxy: proxyUrl,     // /api/mexc-ticker?symbol=...&market=...
    original: null,      // навмисно прибрано (CORS)
    corsproxy: null,     // прибрано
    codetabs: null,      // прибрано
  };
}
