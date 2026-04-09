// src/utils/dropstab.js

// Slugify that matches Dropstab's URL format (same logic as edge function slugifyLite)
function slugifyCoinName(name) {
  if (!name) return null;
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

export function buildDropstabUrl(coin) {
  // 1. Prefer stored slug from DB (most reliable, from Dropstab API)
  const storedSlug = coin?.dropstab_slug;
  if (storedSlug && typeof storedSlug === 'string' && storedSlug.trim()) {
    return `https://dropstab.com/coins/${storedSlug.trim()}`;
  }
  // 2. Fallback: slugify the coin name
  const slug = slugifyCoinName(coin?.name);
  if (!slug) return null;
  return `https://dropstab.com/coins/${slug}`;
}
