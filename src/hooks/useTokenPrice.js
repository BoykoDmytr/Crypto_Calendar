import { useEffect, useState } from 'react';

const MINUTE = 60_000;

const stores = new Map();

const priceRegexes = [
  /"priceUsd"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"priceUSD"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"usdPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"price_usd"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /\bpriceUsd\b[^0-9A-Za-z]*(?<price>[-0-9.,eE]+)/i,
];

const defaultSnapshot = {
  price: null,
  loading: false,
  error: null,
  lastUpdated: null,
};

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 12,
});

function normalizeLink(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return trimmed;
  }
}

function createSnapshot(store) {
  return {
    price: store.price,
    loading: store.loading,
    error: store.error,
    lastUpdated: store.lastUpdated,
  };
}

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseTokenMeta(link) {
  try {
    const url = new URL(link);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[0].toLowerCase() === 'token') {
      return {
        chain: segments[1],
        address: segments[2],
      };
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const cleaned = trimmed.replace(/[^0-9.,eE+-]/g, '');
    if (!cleaned) return null;

    let normalized = cleaned;
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');
    if (hasComma && hasDot) {
      normalized = cleaned.replace(/,/g, '');
    } else if (hasComma && !hasDot) {
      normalized = cleaned.replace(/,/g, '.');
    }
    const num = Number(normalized);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function extractPriceFromObject(obj) {
  let found = null;

  const visit = (node, keyPath = []) => {
    if (found !== null) return;
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, keyPath);
        if (found !== null) return;
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (found !== null) break;
      const lowerKey = key.toLowerCase();

      if (value !== null && typeof value === 'object') {
        visit(value, keyPath.concat(lowerKey));
        continue;
      }

      if (typeof value === 'number' || typeof value === 'string') {
        if (lowerKey.includes('change') || lowerKey.includes('percent')) continue;
        if (!lowerKey.includes('price')) continue;

        const hasUsdHint =
          lowerKey.includes('usd') ||
          keyPath.some((segment) => segment.includes('usd'));

        if (!hasUsdHint && lowerKey !== 'price') continue;

        const num = sanitizeNumber(value);
        if (num !== null && num > 0) {
          found = num;
          break;
        }
      }
    }
  };

  visit(obj);
  return found;
}

function extractFromHtml(text) {
  const scriptMatch = text.match(
    /<script id="__NEXT_DATA__" type="application\/json">(?<json>[\s\S]+?)<\/script>/
  );
  if (scriptMatch?.groups?.json) {
    try {
      const json = JSON.parse(scriptMatch.groups.json);
      const price = extractPriceFromObject(json);
      if (price !== null) return price;
    } catch {
      // ignore JSON parse errors and continue with regexes
    }
  }

  for (const regex of priceRegexes) {
    const match = regex.exec(text);
    if (match?.groups?.price) {
      const num = sanitizeNumber(match.groups.price);
      if (num !== null && num > 0) return num;
    }
  }

  return null;
}

async function fetchEndpoint(endpoint, signal) {
  const response = await fetch(endpoint, {
    signal,
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text) throw new Error('Порожня відповідь');

  try {
    const json = JSON.parse(text);
    const price = extractPriceFromObject(json);
    if (price !== null) return price;
  } catch {
    // not JSON, try HTML parsing below
  }

  const price = extractFromHtml(text);
  if (price !== null) return price;

  throw new Error('Не знайдено значення ціни');
}

async function fetchTokenPrice(link, signal) {
  const endpoints = [];
  const meta = parseTokenMeta(link);
  if (meta) {
    const { chain, address } = meta;
    endpoints.push(`https://debot.ai/api/token/${chain}/${address}`);
    endpoints.push(`https://debot.ai/api/token/${chain}/${address}?format=json`);
    endpoints.push(`https://debot.ai/api/token-price/${chain}/${address}`);
  }
  endpoints.push(link);

  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const price = await fetchEndpoint(endpoint, signal);
      if (price !== null) return price;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      errors.push(`${endpoint}: ${err?.message || err}`);
    }
  }

  const message = errors.length
    ? `Не вдалося отримати ціну. Деталі: ${errors.join(' | ')}`
    : 'Не вдалося отримати ціну';
  throw new Error(message);
}

function getStore(link) {
  let store = stores.get(link);
  if (!store) {
    store = {
      link,
      price: null,
      loading: false,
      error: null,
      lastUpdated: null,
      listeners: new Set(),
      timer: null,
      controller: null,
      inFlight: null,
    };
    stores.set(link, store);
  }
  return store;
}

function notify(store) {
  const snapshot = createSnapshot(store);
  store.listeners.forEach((listener) => {
    listener(snapshot);
  });
}

function runFetch(store) {
  if (store.inFlight) return store.inFlight;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  store.controller = controller;
  store.loading = true;
  store.error = null;
  notify(store);

  const promise = fetchTokenPrice(store.link, controller?.signal)
    .then((price) => {
      store.price = price;
      store.lastUpdated = Date.now();
      store.error = null;
    })
    .catch((err) => {
      if (err?.name === 'AbortError') {
        throw err;
      }
      store.error = err?.message || 'Не вдалося отримати ціну';
    })
    .finally(() => {
      store.loading = false;
      notify(store);
      store.controller = null;
      store.inFlight = null;
    });

  store.inFlight = promise.catch(() => {});
  return store.inFlight;
}

function subscribe(link, listener) {
  const store = getStore(link);
  store.listeners.add(listener);

  if (!store.price && !store.loading && !store.error) {
    store.loading = true;
  }

  listener(createSnapshot(store));

  if (!store.timer) {
    runFetch(store);
    store.timer = setInterval(() => {
      runFetch(store);
    }, MINUTE);
  }

  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) {
      if (store.timer) {
        clearInterval(store.timer);
        store.timer = null;
      }
      if (store.controller) {
        store.controller.abort();
        store.controller = null;
      }
      stores.delete(link);
    }
  };
}

function getSnapshot(link) {
  const store = stores.get(link);
  if (!store) return { ...defaultSnapshot };
  return createSnapshot(store);
}

export function useTokenPrice(rawLink) {
  const normalizedLink = normalizeLink(rawLink);
  const [state, setState] = useState(() => getSnapshot(normalizedLink));

  useEffect(() => {
    const canonical = normalizeLink(rawLink);
    if (!canonical) {
      setState({ ...defaultSnapshot });
      return undefined;
    }

    if (!isHttpUrl(canonical)) {
      setState({
        price: null,
        loading: false,
        error: 'Некоректне посилання',
        lastUpdated: null,
      });
      return undefined;
    }

    let active = true;
    const unsubscribe = subscribe(canonical, (snapshot) => {
      if (!active) return;
      setState(snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [rawLink]);

  return state;
}

export function formatQuantity(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return numberFormatter.format(num);
}