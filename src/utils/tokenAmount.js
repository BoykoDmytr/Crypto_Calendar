const DECIMAL_REGEX = /^-?\d+(?:\.\d+)?$/;

function ensureStringValue(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid numeric value');
    }
    return value.toString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error('Unsupported value type');
}

export function toBaseUnits(value, decimals) {
  const normalized = ensureStringValue(value);
  if (normalized === '') {
    return 0n;
  }
  if (!DECIMAL_REGEX.test(normalized)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, rawFraction = ''] = unsigned.split('.');
  const fraction = rawFraction.slice(0, decimals).padEnd(decimals, '0');
  const base = (wholePart + fraction).replace(/^0+/, '') || '0';
  const result = BigInt(base);
  return negative ? -result : result;
}

export function fromBaseUnits(value, decimals, { maximumFractionDigits = decimals, minimumFractionDigits = 0 } = {}) {
  let amount = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const negative = amount < 0n;
  if (negative) {
    amount = -amount;
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  let fraction = (amount % divisor).toString().padStart(decimals, '0');
  if (maximumFractionDigits < decimals) {
    fraction = fraction.slice(0, maximumFractionDigits);
  }
  if (minimumFractionDigits > fraction.length) {
    fraction = fraction.padEnd(minimumFractionDigits, '0');
  }
  if (maximumFractionDigits === 0) {
    fraction = '';
  }
  fraction = fraction.replace(/0+$/, '');
  const sign = negative ? '-' : '';
  if (!fraction) {
    return `${sign}${whole.toString()}`;
  }
  return `${sign}${whole.toString()}.${fraction}`;
}

function addThousandsSeparator(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatTokenAmount(value, decimals, { maximumFractionDigits = 2, minimumFractionDigits = 0, compact = false, locale = 'en-US' } = {}) {
  const decimalString = fromBaseUnits(value, decimals, {
    maximumFractionDigits: Math.max(maximumFractionDigits, minimumFractionDigits),
    minimumFractionDigits,
  });

  const numeric = Number(decimalString);
  if (compact && Number.isFinite(numeric) && Math.abs(numeric) < 1e15) {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits,
      minimumFractionDigits,
      notation: 'compact',
    }).format(numeric);
  }

  const [whole, fraction = ''] = decimalString.split('.');
  const formattedWhole = addThousandsSeparator(whole);
  const trimmedFraction = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');

  if (trimmedFraction.length === 0) {
    return formattedWhole;
  }

  return `${formattedWhole}.${trimmedFraction}`;
}

export function formatPercent(value, { maximumFractionDigits = 2, minimumFractionDigits = 0, locale = 'en-US' } = {}) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(value / 100);
}