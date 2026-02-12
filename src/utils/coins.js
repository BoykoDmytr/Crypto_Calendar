// src/utils/coins.js
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

/**
 * Normalizes a coin entry.
 * The second argument `defaults` allows substituting name / quantity / address / price_link
 * from the event level (coin_name, coin_quantity, coin_address or coin_price_link), if
 * they are not present on the item itself.  Historically `price_link` represented a
 * Debot or MEXC URL; with the CoinGecko integration we now store a `coin_address`
 * separately.  To preserve backwards compatibility, both `address` and `price_link`
 * are read from incoming data and surfaced in the normalized result.
 */
function normalizeCoinEntry(coin, defaults = {}) {
  if (!coin) return null;

  const rawName =
    coin.name ??
    coin.coin_name ??
    coin.title ??
    defaults.name ??
    '';

  // price_link retains old behaviour: Debot/MEXC URL if supplied
  const rawPriceLink =
    coin.price_link ??
    coin.priceLink ??
    coin.link ??
    defaults.price_link ??
    '';

  // contract address: prefer explicit address/coin_address/contract fields
  const rawAddress =
    coin.address ??
    coin.coin_address ??
    coin.contract ??
    defaults.address ??
    '';

  const rawQuantity =
    coin.quantity ??
    coin.amount ??
    coin.coin_quantity ??
    coin.qty ??
    coin.coinAmount ??
    defaults.quantity;

  const name =
    typeof rawName === 'string' ? rawName.trim() : String(rawName ?? '').trim();

  const priceLink =
    typeof rawPriceLink === 'string'
      ? rawPriceLink.trim()
      : String(rawPriceLink ?? '').trim();

  const address =
    typeof rawAddress === 'string'
      ? rawAddress.trim()
      : String(rawAddress ?? '').trim();

  const quantity = parseCoinQuantity(rawQuantity);

  const hasName = name.length > 0;
  const hasQuantity = quantity !== null;
  const hasAddress = address.length > 0;
  const hasPriceLink = priceLink.length > 0;

  // If nothing is specified – ignore this entry
  if (!hasName && !hasQuantity && !hasAddress && !hasPriceLink) {
    return null;
  }

  const normalized = {};
  if (hasName) normalized.name = name;
  if (hasQuantity) normalized.quantity = quantity;
  // expose address if present; prefer explicit address over price_link
  if (hasAddress) normalized.address = address;
  // preserve price_link for backwards compatibility
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

/**
 * Main function:
 * - reads coins from source.coins / source.payload.coins / the source itself;
 * - substitutes defaults from the event level: coin_name, coin_quantity, coin_address or coin_price_link.
 */
export function extractCoinEntries(source) {
  if (!source) return [];

  const result = [];
  const candidates = [];

  // Defaults from the event level (events_approved / events_pending / auto_events_pending)
  const rootDefaults =
    source && typeof source === 'object'
      ? {
          name: source.coin_name,
          quantity: source.coin_quantity,
          // if coin_address is missing, fall back to coin_price_link for legacy events
          address: source.coin_address || null,
          price_link: source.coin_price_link,
        }
      : {};

  // Case when we were given an array / string of coins directly
  if (Array.isArray(source) || typeof source === 'string') {
    candidates.push({ raw: source, defaults: {} });
  }

  // Case when an event / payload with a coins field was supplied
  if (source && typeof source === 'object') {
    if ('coins' in source) {
      candidates.push({ raw: source.coins, defaults: rootDefaults });
    }
    if (
      source.payload &&
      typeof source.payload === 'object' &&
      'coins' in source.payload
    ) {
      candidates.push({ raw: source.payload.coins, defaults: rootDefaults });
    }
  }

  for (const candidate of candidates) {
    const list = coerceCoinList(candidate.raw);
    if (!list.length) continue;

    for (const item of list) {
      const normalized = normalizeCoinEntry(item, candidate.defaults);
      if (normalized) result.push(normalized);
    }

    // Stop at the first non-empty set
    if (result.length > 0) break;
  }

  // Fallback to root-level fields if no coins were found
  if (result.length === 0 && !Array.isArray(source) && source && typeof source === 'object') {
    const fallback = normalizeCoinEntry(
      {
        name: source.coin_name,
        quantity: source.coin_quantity,
        address: source.coin_address,
        price_link: source.coin_price_link,
      },
      rootDefaults
    );
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

    // Compare address first; fallback to price_link for legacy entries
    const addrA = a.address || a.price_link || '';
    const addrB = b.address || b.price_link || '';
    if ((addrA || '') !== (addrB || '')) return false;
  }

  return true;
}