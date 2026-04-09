// src/utils/dropstab.js

// Slugify matching Dropstab's URL format (same logic as edge function slugifyLite)
export function buildDropstabUrl(coin) {
  // Prefer stored slug from DB (most reliable - verified by edge function)
  if (coin?.dropstab_slug) {
    return `https://dropstab.com/coins/${coin.dropstab_slug}`;
  }
  // Fallback: slugify name
  const name = (coin?.name || '').trim();
  if (!name) return null;
  const slug = name
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return null;
  return `https://dropstab.com/coins/${slug}`;
}
