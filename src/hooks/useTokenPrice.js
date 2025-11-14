import { useEffect, useState } from 'react';

const MINUTE = 60_000;

const stores = new Map();

const priceRegexes = [
  /"priceUsd"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"priceUSD"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"usdPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"price_usd"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /\bpriceUsd\b[^0-9A-Za-z]*(?<price>[-0-9.,eE]+)/i,
  /"usd_last_price"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"usdLastPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"lastPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?(?![^,]*change)/i,
  /"tokenPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?/i,
  /"price"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?\s*(?:USD|\$)?/i,
  /\bprice\b[^0-9A-Za-z]*(?<price>[-0-9.,eE]+)\s*(?:USD|\$)/i,
];

const mexcSellPriceRegexes = [
  /"sellPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)/gi,
  /"sell_price"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)/gi,
  /"askPrice"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)/gi,
  /"ask_price"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)/gi,
  /"price"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?\s*,\s*"side"\s*[:=]\s*"?(?:sell|ask)"?/gi,
  /"price"\s*[:=]\s*"?(?<price>[-0-9.,eE]+)"?\s*,\s*"type"\s*[:=]\s*"?(?:sell|ask)"?/gi,
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

function normalizeChainIdentifier(chain) {
  const trimmed = typeof chain === 'string' ? chain.trim() : '';
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[\s_]+/g, '-');

  if (
    normalized === 'sol' ||
    normalized === 'solana' ||
    normalized.startsWith('solana-') ||
    normalized.startsWith('sol-')
  ) {
    return 'solana';
  }

  return normalized;
}

function buildChainCandidates(chain) {
  const trimmed = typeof chain === 'string' ? chain.trim() : '';
  if (!trimmed) return [];

  const candidates = new Set();
  candidates.add(trimmed);

  const lower = trimmed.toLowerCase();
  if (lower) candidates.add(lower);

  const normalized = lower.replace(/[\s_]+/g, '-');
  if (normalized) candidates.add(normalized);

  const canonical = normalizeChainIdentifier(trimmed);
  if (canonical) {
    candidates.add(canonical);
    if (canonical === 'solana') {
      candidates.add('sol');
    }
  }

  return Array.from(candidates).filter(Boolean);
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
    if (segments.length < 3) return null;

    const lowerSegments = segments.map((segment) => segment.toLowerCase());
    const tokenIndex = lowerSegments.findIndex((segment) =>
      segment === 'token' || segment === 'token-price'
    );

    if (tokenIndex !== -1 && segments.length > tokenIndex + 2) {
      return {
        chain: segments[tokenIndex + 1],
        address: segments[tokenIndex + 2],
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseMexcPreMarketLink(link) {
  try {
    const url = new URL(link);
    const hostname = url.hostname.toLowerCase();
    if (!hostname.endsWith('mexc.com')) return null;

    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.length) return null;

    const preMarketIndex = segments.findIndex((segment) => segment.toLowerCase() === 'pre-market');
    if (preMarketIndex === -1 || preMarketIndex >= segments.length - 1) return null;

    const slug = segments[preMarketIndex + 1];
    if (!slug) return null;

    return { slug };
  } catch {
    return null;
  }
}

const dexScreenerNetworkMap = {
  ton: 'ton',
  eth: 'ethereum',
  ethereum: 'ethereum',
  bsc: 'bsc',
  binance: 'bsc',
  'binance-smart-chain': 'bsc',
  matic: 'polygon',
  polygon: 'polygon',
  sol: 'solana',
  solana: 'solana',
  'solana-mainnet': 'solana',
  'solana-mainnet-beta': 'solana',
  'sol-mainnet': 'solana',
  'sol-mainnet-beta': 'solana',
  tron: 'tron',
  trx: 'tron',
  avax: 'avalanche',
  avalanche: 'avalanche',
  arbitrum: 'arbitrum',
  arb: 'arbitrum',
  optimism: 'optimism',
  opt: 'optimism',
  base: 'base',
  fantom: 'fantom',
  ftm: 'fantom',
  linea: 'linea',
  celo: 'celo',
  harmony: 'harmony',
};

function describeEndpoint(entry) {
  if (!entry) return 'невідомий ендпоїнт';
  if (typeof entry === 'string') return entry;
  if (entry.label && entry.url) return `${entry.label}: ${entry.url}`;
  if (entry.url) return entry.url;
  return 'невідомий ендпоїнт';
}

function selectBestDexScreenerPair(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  let best = null;
  let bestLiquidity = 0;
  for (const pair of pairs) {
    const priceCandidate =
      sanitizeNumber(pair?.priceUsd) ??
      sanitizeNumber(pair?.price?.usd) ??
      sanitizeNumber(pair?.price?.usdPrice);
    if (priceCandidate === null || priceCandidate === undefined) continue;

    const liquidityCandidate =
      sanitizeNumber(pair?.liquidity?.usd) ??
      sanitizeNumber(pair?.liquidityUsd) ??
      sanitizeNumber(pair?.liquidity?.usdValue);

    const liquidity = Number.isFinite(liquidityCandidate) ? liquidityCandidate : 0;
    if (!best || liquidity > bestLiquidity) {
      best = priceCandidate;
      bestLiquidity = liquidity;
    }
  }
  return best;
}

function parseDexScreenerPrice({ getJson }) {
  const json = getJson();
  if (!json) return null;
  const pairs = json?.pairs || json?.data?.pairs || null;
  const price = selectBestDexScreenerPair(pairs);
  if (price !== null && price !== undefined && Number(price) > 0) {
    return price;
  }
  return null;
}

function parseJupiterPrice({ getJson }) {
  const json = getJson();
  if (!json) return null;
  const data = json?.data;
  if (!data || typeof data !== 'object') return null;
  for (const entry of Object.values(data)) {
    if (!entry || typeof entry !== 'object') continue;
    const direct =
      sanitizeNumber(entry?.price) ??
      sanitizeNumber(entry?.usd) ??
      sanitizeNumber(entry?.value) ??
      sanitizeNumber(entry?.priceUsd) ??
      sanitizeNumber(entry?.usdPrice);
    if (direct !== null && direct !== undefined && Number(direct) > 0) {
      return direct;
    }

    const extraCandidate =
      sanitizeNumber(entry?.extra?.price) ??
      sanitizeNumber(entry?.extra?.usd) ??
      sanitizeNumber(entry?.extra?.value) ??
      sanitizeNumber(entry?.extra?.priceUsd) ??
      sanitizeNumber(entry?.extra?.usdPrice);
    if (extraCandidate !== null && extraCandidate !== undefined && Number(extraCandidate) > 0) {
      return extraCandidate;
    }
  }
  return null;
}

function parseSolscanMarketData({ getJson }) {
  const json = getJson();
  if (!json) return null;

  const tryCandidates = (values) => {
    for (const value of values) {
      const num = sanitizeNumber(value);
      if (num !== null && num > 0) {
        return num;
      }
    }
    return null;
  };

  const primary = tryCandidates([
    json?.data?.priceUsdt,
    json?.data?.priceUsd,
    json?.data?.price,
    json?.data?.usdPrice,
    json?.priceUsdt,
    json?.priceUsd,
    json?.price,
  ]);
  if (primary !== null) return primary;

  const markets = Array.isArray(json?.data?.markets)
    ? json.data.markets
    : Array.isArray(json?.markets)
    ? json.markets
    : null;

  if (markets) {
    for (const market of markets) {
      const marketPrice = tryCandidates([
        market?.priceUsdt,
        market?.priceUsd,
        market?.price,
        market?.usdPrice,
      ]);
      if (marketPrice !== null) {
        return marketPrice;
      }
    }
  }

  return null;
}

function parseTonapiJettonInfo({ getJson }) {
  const json = getJson();
  if (!json) return null;
  const direct =
    sanitizeNumber(json?.price?.usd) ??
    sanitizeNumber(json?.market_data?.price_usd) ??
    sanitizeNumber(json?.market_data?.priceUSD) ??
    sanitizeNumber(json?.price_usd) ??
    sanitizeNumber(json?.priceUSD);
  if (direct !== null && direct !== undefined && Number(direct) > 0) {
    return direct;
  }
  return null;
}

function parseTonapiJettonPrices({ getJson }) {
  const json = getJson();
  if (!json) return null;
  const items = json?.prices || json?.data?.prices;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const candidate =
      sanitizeNumber(item?.price?.usd) ??
      sanitizeNumber(item?.usd) ??
      sanitizeNumber(item?.priceUsd) ??
      sanitizeNumber(item?.usdPrice);
    if (candidate !== null && candidate !== undefined && Number(candidate) > 0) {
      return candidate;
    }
  }
  return null;
}

function parseMexcPreMarketPrice({ text }) {
  if (!text) return null;

  const addCandidate = (() => {
    let best = null;
    return (value) => {
      const num = sanitizeNumber(value);
      if (num !== null && num > 0) {
        best = best === null ? num : Math.min(best, num);
      }
      return best;
    };
  })();

  let bestCandidate = null;

  for (const regex of mexcSellPriceRegexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      const price = match?.groups?.price ?? match?.[1];
      const candidate = addCandidate(price);
      if (candidate !== null && candidate !== undefined) {
        bestCandidate = candidate;
      }
    }
  }

  if (bestCandidate !== null) {
    return bestCandidate;
  }

  const plainMatch = text.match(/sellPrice[^0-9A-Za-z+-]*([-0-9.,eE]+)/i);
  if (plainMatch?.[1]) {
    const num = sanitizeNumber(plainMatch[1]);
    if (num !== null && num > 0) {
      return num;
    }
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const selectorGroups = [
        '[class*="sellPrice"]',
        '[class*="askPrice"]',
        '[data-column="sellPrice"]',
        '[data-column="askPrice"]',
        '[data-field="sellPrice"]',
        '[data-field="askPrice"]',
      ];

      let bestFromDom = null;

      for (const selector of selectorGroups) {
        const elements = doc.querySelectorAll(selector);
        elements.forEach((el) => {
          const num = sanitizeNumber(el?.textContent ?? el?.getAttribute?.('value'));
          if (num !== null && num > 0) {
            bestFromDom = bestFromDom === null ? num : Math.min(bestFromDom, num);
          }
        });
        if (bestFromDom !== null) {
          return bestFromDom;
        }
      }
    } catch {
      // ignore DOM parsing issues
    }
  }

  const htmlSellPriceRegexes = [
    /<[^>]*class\s*=\s*"[^"]*order-book-table_sellPrice[^"]*"[^>]*>(?<price>[^<]+)/gi,
    /<[^>]*class\s*=\s*'[^']*order-book-table_sellPrice[^']*'[^>]*>(?<price>[^<]+)/gi,
    /<[^>]*class\s*=\s*"[^"]*sellPrice[^"]*"[^>]*>(?<price>[^<]+)/gi,
    /<[^>]*class\s*=\s*'[^']*sellPrice[^']*'[^>]*>(?<price>[^<]+)/gi,
  ];

  for (const regex of htmlSellPriceRegexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      const candidate = sanitizeNumber(match?.groups?.price ?? match?.[1]);
      if (candidate !== null && candidate > 0) {
        return candidate;
      }
    }
  }

  return null;
}

function buildFallbackEndpoints(meta) {
  if (!meta?.address) return [];
  const canonicalChain = normalizeChainIdentifier(meta.chain);
  const chain = canonicalChain || (meta?.chain || '').toLowerCase();
  const address = meta.address;
  const encodedAddress = encodeURIComponent(address);
  const endpoints = [];

  const dexNetwork = dexScreenerNetworkMap[chain] || dexScreenerNetworkMap[canonicalChain];
  const dexCandidates = new Set();
  if (dexNetwork) {
    dexCandidates.add(`https://api.dexscreener.com/latest/dex/tokens/${dexNetwork}/${encodedAddress}`);
    if (
      ['ethereum', 'bsc', 'polygon', 'base', 'arbitrum', 'optimism', 'avalanche', 'fantom', 'solana'].includes(
        dexNetwork
      )
    ) {
      dexCandidates.add(`https://api.dexscreener.com/latest/dex/tokens/${encodedAddress}`);
    }
  } else if (address?.startsWith('0x')) {
    dexCandidates.add(`https://api.dexscreener.com/latest/dex/tokens/${encodedAddress}`);
  }

  for (const url of dexCandidates) {
    endpoints.push({
      url,
      label: 'DexScreener',
      parser: parseDexScreenerPrice,
    });
  }

  if (chain === 'ton') {
    endpoints.push({
      url: `https://tonapi.io/v2/jetton/info?address=${encodedAddress}`,
      label: 'TonAPI jetton info',
      parser: parseTonapiJettonInfo,
    });
    endpoints.push({
      url: `https://tonapi.io/v2/jetton/prices?tokens=${encodedAddress}`,
      label: 'TonAPI jetton prices',
      parser: parseTonapiJettonPrices,
    });
  }

  if (chain === 'solana' || chain === 'sol') {
    endpoints.push({
      url: `https://price.jup.ag/v6/price?ids=${encodedAddress}`,
      label: 'Jupiter price',
      parser: parseJupiterPrice,
    });
    endpoints.push({
      url: `https://public-api.solscan.io/market/token/${encodedAddress}`,
      label: 'Solscan market data',
      parser: parseSolscanMarketData,
    });
  }
  return endpoints;
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

  const hasUsdHintInValue = (value, depth = 0) => {
    if (!value || depth > 2) return false;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return (
        normalized.includes('usd') ||
        normalized.includes('dollar') ||
        normalized.includes('usdc') ||
        normalized.includes('usdt') ||
        normalized.includes('$')
      );
    }
    if (Array.isArray(value)) {
      return value.some((item) => hasUsdHintInValue(item, depth + 1));
    }
    if (typeof value === 'object') {
      const nestedKeys = [
        'symbol',
        'code',
        'currency',
        'currencyCode',
        'currencySymbol',
        'name',
        'ticker',
        'denom',
        'unit',
        'id',
        'label',
        'target',
        'pair',
        'quote',
        'quoteCurrency',
        'quoteSymbol',
      ];
      return nestedKeys.some((key) => hasUsdHintInValue(value[key], depth + 1));
    }
    return false;
  };

  const objectHasUsdHint = (node) => {
    if (!node || typeof node !== 'object') return false;
    const fields = [
      'currency',
      'currencyCode',
      'currencySymbol',
      'fiat',
      'fiatCurrency',
      'fiatSymbol',
      'symbol',
      'unit',
      'ticker',
      'denom',
      'code',
      'quote',
      'quoteCurrency',
      'quoteSymbol',
      'counterCurrency',
      'counterSymbol',
    ];
    return fields.some((field) => hasUsdHintInValue(node[field]));
  };

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
      const normalizedKey = lowerKey.replace(/[^a-z0-9]/g, '');

      if (value !== null && typeof value === 'object') {
        visit(value, keyPath.concat(lowerKey));
        continue;
      }

      if (typeof value === 'number' || typeof value === 'string') {
        if (lowerKey.includes('change') || lowerKey.includes('percent')) continue;
        if (normalizedKey.includes('history') || normalizedKey.includes('spark')) continue;

        const normalizedPath = keyPath.map((segment) => segment.replace(/[^a-z0-9]/g, ''));
        const hasQuoteContext = normalizedPath.some((segment) => segment.includes('quote'));
        const hasFiatContext = normalizedPath.some((segment) => segment.includes('fiat'));
        const hasUsdInPath =
          lowerKey.includes('usd') ||
          normalizedPath.some((segment) => segment.includes('usd') || segment.includes('dollar'));

        const hasPriceContext =
          lowerKey.includes('price') ||
          normalizedPath.some((segment) => segment.includes('price')) ||
          ((normalizedKey === 'value' || normalizedKey === 'amount' || normalizedKey.endsWith('value') || normalizedKey.endsWith('amount')) &&
            (hasQuoteContext || hasFiatContext) &&
            (hasUsdInPath || objectHasUsdHint(node)));

        if (!hasPriceContext) continue;

        const parentHasUsdHint = objectHasUsdHint(node);
        const valueHasUsdHint = typeof value === 'string' ? hasUsdHintInValue(value) : false;
        const hasUsdHint = hasUsdInPath || parentHasUsdHint || valueHasUsdHint;

        const isPrimaryPriceKey =
          normalizedKey === 'price' ||
          normalizedKey === 'tokenprice' ||
          normalizedKey === 'lastprice' ||
          normalizedKey === 'currentprice' ||
          normalizedKey === 'spotprice' ||
          normalizedKey === 'closeprice' ||
          normalizedKey === 'latestprice' ||
          normalizedKey === 'usdprice' ||
          normalizedKey === 'priceusd' ||
          normalizedKey === 'priceinusd' ||
          normalizedKey.startsWith('priceusd') ||
          normalizedKey.endsWith('usdprice');

        const isValueLikeKey =
          normalizedKey === 'value' ||
          normalizedKey === 'amount' ||
          normalizedKey.endsWith('value') ||
          normalizedKey.endsWith('amount');

        if (!hasUsdHint && !isPrimaryPriceKey) continue;
        if (isValueLikeKey && !hasUsdHint && !isPrimaryPriceKey) continue;

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

function tryParseJsonPayload(payload) {
  if (!payload) return null;
  const trimmed = payload.trim();
  if (!trimmed) return null;

  let jsonText = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    jsonText = trimmed;
  } else {
    const assignmentMatch = trimmed.match(/=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?$/);
    if (assignmentMatch?.[1]) {
      jsonText = assignmentMatch[1];
    }
  }

  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      const cleaned = jsonText
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, '&');
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function extractFromHtml(text) {
  const candidates = [];

  const nextScriptMatch = text.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(?<json>[\s\S]+?)<\/script>/i
  );
  if (nextScriptMatch?.groups?.json) {
    candidates.push(nextScriptMatch.groups.json);
  }

  const nuxtScriptMatch = text.match(
    /<script[^>]*id=["']__NUXT_DATA__["'][^>]*>(?<json>[\s\S]+?)<\/script>/i
  );
  if (nuxtScriptMatch?.groups?.json) {
    candidates.push(nuxtScriptMatch.groups.json);
  }

  const inlineNextMatch = text.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]+?\})\s*;?\s*<\/script>/i);
  if (inlineNextMatch?.[1]) {
    candidates.push(inlineNextMatch[1]);
  }

  const inlineNuxtMatch = text.match(/__NUXT__\s*=\s*(\{[\s\S]+?\})\s*;?\s*<\/script>/i);
  if (inlineNuxtMatch?.[1]) {
    candidates.push(inlineNuxtMatch[1]);
  }
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');

      ['__NEXT_DATA__', '__NUXT_DATA__'].forEach((id) => {
        const el = doc.getElementById(id);
        if (el?.textContent) {
          candidates.push(el.textContent);
        }
      });

      doc.querySelectorAll('script').forEach((script) => {
        const content = script.textContent;
        if (!content) return;
        const trimmed = content.trim();
        if (!trimmed) return;

        if (/__NEXT_DATA__\s*=/.test(trimmed) || /__NUXT__\s*=/.test(trimmed)) {
          const match = trimmed.match(/=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?$/);
          if (match?.[1]) {
            candidates.push(match[1]);
          }
          return;
        }

        if (/^[{[]/.test(trimmed) && /[}\]]$/.test(trimmed)) {
          candidates.push(trimmed);
        }
      });

      const metaSelectors = [
        ['meta[property="og:price:amount"]', 'content'],
        ['meta[itemprop="price"]', 'content'],
        ['meta[name="price"]', 'content'],
        ['meta[name="twitter:data1"]', 'content'],
        ['meta[name="twitter:label1"]', 'content'],
      ];

      for (const [selector, attr] of metaSelectors) {
        const el = doc.querySelector(selector);
        const value = el?.getAttribute(attr);
        const num = sanitizeNumber(value);
        if (num !== null && num > 0) {
          return num;
        }
      }

      const dataAttrSelectors = [
        'data-price',
        'data-price-usd',
        'data-usd-price',
        'data-priceusd',
        'data-last-price',
      ];

      for (const attr of dataAttrSelectors) {
        const el = doc.querySelector(`[${attr}]`);
        const num = sanitizeNumber(el?.getAttribute(attr));
        if (num !== null && num > 0) {
          return num;
        }
      }
    } catch {
      // ignore DOM parsing failures
    }
  }

  for (const candidate of candidates) {
    const json = tryParseJsonPayload(candidate);
    if (!json) continue;
    const price = extractPriceFromObject(json);
    if (price !== null) return price;
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

async function fetchEndpoint(entry, signal) {
  const { url, parser, headers: extraHeaders } =
    typeof entry === 'string'
      ? { url: entry, parser: null, headers: null }
      : entry || {};

  if (!url) {
    throw new Error('Некоректна адреса запиту');
  }

  const headers = {
    Accept: 'application/json,text/plain,*/*',
    ...(extraHeaders || {}),
  };

  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text) throw new Error('Порожня відповідь');

  let cachedJson;
  const getJson = () => {
    if (cachedJson !== undefined) return cachedJson;
    try {
      cachedJson = JSON.parse(text);
    } catch {
      cachedJson = null;
    }
    return cachedJson;
  };

  if (typeof parser === 'function') {
    try {
      const parsedValue = parser({
        text,
        response,
        getJson,
      });
      if (parsedValue !== null && parsedValue !== undefined) {
        const numeric = sanitizeNumber(parsedValue);
        if (numeric !== null && numeric > 0) {
          return numeric;
        }
        if (typeof parsedValue === 'number' && Number.isFinite(parsedValue) && parsedValue > 0) {
          return parsedValue;
        }
      }
    } catch (parserError) {
      const message = parserError?.message || 'Помилка обробки відповіді';
      throw new Error(message);
    }
  }

  const json = getJson();
  if (json) {
    const price = extractPriceFromObject(json);
    if (price !== null) return price;
  }

  const price = extractFromHtml(text);
  if (price !== null) return price;

  throw new Error('Не знайдено значення ціни');
}

async function fetchTokenPrice(link, signal) {
  const endpoints = [];
  const seen = new Set();

  const pushEndpoint = (entry) => {
    if (!entry) return;
    const key =
      typeof entry === 'string'
        ? entry
        : entry && entry.url
        ? entry.url
        : JSON.stringify(entry);
    if (!key || seen.has(key)) return;
    seen.add(key);
    endpoints.push(entry);
  };
  const meta = parseTokenMeta(link);
  if (meta) {
    const { address } = meta;
    for (const chainName of buildChainCandidates(meta.chain)) {
      pushEndpoint(`https://debot.ai/api/token/${chainName}/${address}`);
      pushEndpoint(`https://debot.ai/api/token/${chainName}/${address}?format=json`);
      pushEndpoint(`https://debot.ai/api/token-price/${chainName}/${address}`);
    }
  }
  const mexcMeta = parseMexcPreMarketLink(link);
  if (mexcMeta) {
    pushEndpoint({
      url: link,
      label: 'MEXC pre-market сторінка',
      parser: parseMexcPreMarketPrice,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } else {
    pushEndpoint(link);
  }

  if (meta) {
    for (const entry of buildFallbackEndpoints(meta)) {
      pushEndpoint(entry);
    }
  }

  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const price = await fetchEndpoint(endpoint, signal);
      if (price !== null) return price;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      errors.push(`${describeEndpoint(endpoint)}: ${err?.message || err}`);
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