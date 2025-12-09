// src/utils/fetchMexcTicker.js

const DEFAULT_TIMEOUT_MS = 10_000;
const BASE_URL = 'https://api.mexc.com/api/v3/ticker/price';

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
    return await fetch(url, { signal: controller.signal });
  } finally {
    cleanup();
  }
}

function buildCandidates(symbol) {
  const originalUrl = `${BASE_URL}?symbol=${encodeURIComponent(symbol)}&_=${Date.now()}`;

  // CORS-friendly proxies first, then direct fetch
  return [
    {
      label: 'corsproxy.io',
      url: `https://corsproxy.io/?${encodeURIComponent(originalUrl)}`,
    },
    {
      label: 'allorigins',
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(originalUrl)}`,
    },
    {
      label: 'codetabs',
      url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(originalUrl)}`,
    },
    {
      label: 'direct',
      url: originalUrl,
    },
  ];
}

function parsePrice(data) {
  const raw = data?.price ?? data?.lastPrice;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

/**
 * Отримати ціну MEXC для символу типу "BTCUSDT" з таймаутом та фолбеком.
 */
export async function fetchMexcTickerPrice(symbol, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const candidates = buildCandidates(symbol);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const res = await fetchWithTimeout(candidate.url, timeoutMs);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`MEXC status ${res.status}: ${body.slice(0, 200)}`);
      }
      const rawBody = await res.text();
      let data;
      try {
        data = JSON.parse(rawBody);
      } catch (parseError) {
        throw new Error(
          `Invalid JSON from ${candidate.label}: ${parseError.message}; body: ${rawBody.slice(0, 200)}`
        );
      }
      const price = parsePrice(data);

      if (price === null) {
        throw new Error('Invalid MEXC price payload');
      }

      return { price, source: candidate.label };
    } catch (error) {
      lastError = error;
      console.error('[MEXC] fetch candidate failed', candidate.label, error);
    }
  }

  throw lastError ?? new Error('Failed to fetch MEXC price');
}

export function buildMexcTickerUrl(symbol) {
  const candidates = buildCandidates(symbol);
  return {
    corsproxy: candidates.find((c) => c.label === 'corsproxy.io')?.url,
    original: candidates.find((c) => c.label === 'direct')?.url,
    proxy: candidates.find((c) => c.label === 'allorigins')?.url,
    codetabs: candidates.find((c) => c.label === 'codetabs')?.url,
  };
}