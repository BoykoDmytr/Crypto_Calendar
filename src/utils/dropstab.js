/* eslint-env node */
/* global process */
// src/utils/dropstab.js
import slugify from 'slugify';

/**
 * Повертає circulating supply для переданої назви монети.
 * Використовується Dropstab API. Якщо монету не знайдено або стався
 * network‑збій, повертає null.
 *
 * @param {string} coinName Назва токена, наприклад "Aztec"
 */
export async function getCirculatingSupply(coinName) {
  // створюємо slug на основі назви (Dropstab використовує низькорегістрові слаги)
  const slug = slugify(coinName, { lower: true, strict: true });
  const apiKey =
    process.env.NEXT_PUBLIC_DROPSTAB_API_KEY || process.env.DROPSTAB_API_KEY;
  if (!apiKey) {
    console.error('DROPSTAB_API_KEY is not defined');
    return null;
  }
  try {
    const res = await fetch(
      `https://public-api.dropstab.com/api/v1/coins/detailed/${slug}`,
      {
        headers: {
          accept: 'application/json',
          'x-dropstab-api-key': apiKey,
        },
      },
    );
    if (!res.ok) {
      console.error('Dropstab API error', res.status);
      return null;
    }
    const json = await res.json();
    // Відповідь містить об'єкт { status: 'OK', data: {...} }
    const circ = json?.data?.circulatingSupply;
    return typeof circ === 'number' ? circ : null;
  } catch (e) {
    console.error('Dropstab API fetch failed', e);
    return null;
  }
}

/**
 * Форматує відсоток для відображення. Використовується
 * у віджеті EventTokenInfo.
 *
 * @param {number|null|undefined} p Відсоток
 */
export function formatPercent(p) {
  if (p == null || isNaN(p)) return '';
  const abs = Math.abs(p);
  if (abs >= 1) return `${p.toFixed(2)}%`;
  if (abs >= 0.1) return `${p.toFixed(3)}%`;
  if (abs >= 0.01) return `${p.toFixed(4)}%`;
  return `${p.toExponential(2)}%`;
}

/**
 * Допоміжна функція, яка перетворює рядок кількості токенів на число.
 * Використовує parseQuantity з util/coins, але дублюється тут для прикладу.
 * @param {string} qtyStr
 */
export function parseAmount(qtyStr) {
  if (!qtyStr) return 0;
  // Видаляємо коми, пробіли та інші розділювачі тисяч
  const cleaned = qtyStr.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}