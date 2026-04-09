// src/utils/dropstab.js

// Build Dropstab URL only from verified slug stored in DB.
// No local slugify fallback — if slug is missing, return null
// so the frontend renders a plain <span> instead of a broken link.
export function buildDropstabUrl(coin) {
  const slug = coin?.dropstab_slug;
  if (!slug || typeof slug !== 'string' || !slug.trim()) return null;
  return `https://dropstab.com/coins/${slug.trim()}`;
}
