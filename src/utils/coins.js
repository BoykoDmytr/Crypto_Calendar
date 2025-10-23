const TRIM_REGEX = /\s+/g;

export function parseCoinQuantity(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(TRIM_REGEX, '').replace(/,/g, '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function normalizeCoinEntry(coin) {
  if (!coin) return null;

  const rawName = coin.name ?? coin.coin_name ?? coin.title ?? '';
  const rawPriceLink = coin.price_link ?? coin.priceLink ?? coin.link ?? '';
  const rawQuantity =
    coin.quantity ??
    coin.amount ??
    coin.coin_quantity ??
    coin.qty ??
    coin.coinAmount;

  const name = typeof rawName === 'string' ? rawName.trim() : String(rawName ?? '').trim();
  const priceLink =
    typeof rawPriceLink === 'string'
      ? rawPriceLink.trim()
      : String(rawPriceLink ?? '').trim();
  const quantity = parseCoinQuantity(rawQuantity);

  const hasName = name.length > 0;
  const hasQuantity = quantity !== null;
  const hasPriceLink = priceLink.length > 0;

  if (!hasName && !hasQuantity && !hasPriceLink) {
    return null;
  }

  const normalized = {};
  if (hasName) normalized.name = name;
  if (hasQuantity) normalized.quantity = quantity;
  if (hasPriceLink) normalized.price_link = priceLink;

  return normalized;
}

function numericKeysToArray(value) {
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value);
  if (keys.length === 0) return [];
  if (!keys.every((key) => /^\d+$/.test(key))) return [];
  return keys
    .map((key) => Number.parseInt(key, 10))
    .sort((a, b) => a - b)
    .map((key) => value[key]);
}

function coerceCoinList(candidate) {
  if (!candidate) return [];
  if (Array.isArray(candidate)) return candidate;
  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      const fromObject = numericKeysToArray(parsed);
      if (fromObject.length > 0) return fromObject;
    } catch {
      return [];
    }
    return [];
  }
  const fromObject = numericKeysToArray(candidate);
  if (fromObject.length > 0) return fromObject;
  return [];
}

export function extractCoinEntries(source) {
  if (!source) return [];

  const result = [];
  const candidates = [];

  if (Array.isArray(source) || typeof source === 'string') {
    candidates.push(source);
  }

  if (source && typeof source === 'object') {
    if ('coins' in source) candidates.push(source.coins);
    if (source.payload && typeof source.payload === 'object' && 'coins' in source.payload) {
      candidates.push(source.payload.coins);
    }
  }

  for (const candidate of candidates) {
    const list = coerceCoinList(candidate);
    if (!list.length) continue;
    for (const item of list) {
      const normalized = normalizeCoinEntry(item);
      if (normalized) result.push(normalized);
    }
    if (result.length > 0) break;
  }

  if (result.length === 0 && !Array.isArray(source)) {
    const fallback = normalizeCoinEntry({
      name: source.coin_name,
      quantity: source.coin_quantity,
      price_link: source.coin_price_link,
    });
    if (fallback) result.push(fallback);
  }

  return result;
}

export function hasCoinEntries(source) {
  return extractCoinEntries(source).length > 0;
}

export function coinEntriesEqual(leftSource, rightSource) {
  const left = extractCoinEntries(leftSource);
  const right = extractCoinEntries(rightSource);

  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] || {};
    const b = right[i] || {};

    if ((a.name || '') !== (b.name || '')) return false;

    const aHasQty = Object.prototype.hasOwnProperty.call(a, 'quantity');
    const bHasQty = Object.prototype.hasOwnProperty.call(b, 'quantity');
    const qtyA = aHasQty ? a.quantity : null;
    const qtyB = bHasQty ? b.quantity : null;
    if (!Object.is(qtyA, qtyB)) return false;

    if ((a.price_link || '') !== (b.price_link || '')) return false;
  }

  return true;
}