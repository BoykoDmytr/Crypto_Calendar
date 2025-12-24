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
 * Нормалізує запис монети.
 * Другий аргумент defaults дозволяє підставити name / quantity / price_link
 * з рівня події (coin_name, coin_quantity, coin_price_link / link), якщо їх немає в самому item.
 */
function normalizeCoinEntry(coin, defaults = {}) {
  if (!coin) return null;

  const rawName =
    coin.name ??
    coin.coin_name ??
    coin.title ??
    defaults.name ??
    '';

  const rawPriceLink =
    coin.price_link ??
    coin.priceLink ??
    coin.link ??
    defaults.price_link ??
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

/**
 * Головна функція:
 * - читає монети з source.coins / source.payload.coins / самого source;
 * - підставляє дефолти з рівня події:
 *   coin_name, coin_quantity, coin_price_link, link.
 */
export function extractCoinEntries(source) {
  if (!source) return [];

  const result = [];
  const candidates = [];

  // Дефолти з рівня події (events_approved / events_pending / auto_events_pending)
  const rootDefaults =
    source && typeof source === 'object'
      ? {
          name: source.coin_name,
          quantity: source.coin_quantity,
          // якщо coin_price_link немає, пробуємо загальний link події
           price_link: source.coin_price_link,
        }
      : {};

  // Варіант, коли нам прямо передали масив / строку монет
  if (Array.isArray(source) || typeof source === 'string') {
    candidates.push({ raw: source, defaults: {} });
  }

  // Варіант, коли передали івент / payload з полем coins
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

    // Якщо вже щось знайшли — далі інші кандидати не дивимося
    if (result.length > 0) break;
  }

  // Якщо з coins нічого не вийшло — падаємо в fallback на root-поля події
  if (result.length === 0 && !Array.isArray(source) && source && typeof source === 'object') {
    const fallback = normalizeCoinEntry(
      {
        name: source.coin_name,
        quantity: source.coin_quantity,
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

    if ((a.price_link || '') !== (b.price_link || '')) return false;
  }

  return true;
}
