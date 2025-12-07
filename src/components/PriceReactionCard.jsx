import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Register dayjs plugins for UTC and timezones.  This ensures that
// formatting functions work properly regardless of the user's locale.
dayjs.extend(utc);
dayjs.extend(timezone);

// Mapping for common timezone labels.  You can extend this if your
// application uses additional labels beyond Kyiv/UTC.
const TZ_MAP = {
  Kyiv: 'Europe/Kyiv',
};

// Format a timestamp into HH:mm in the given timezone.  If no
// timestamp is provided, returns an em dash.
function formatTime(iso, tz) {
  if (!iso) return '—';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('HH:mm');
}

// Format a timestamp into DD MMM HH:mm in the given timezone.  If no
// timestamp is provided, returns an empty string.
function formatDate(iso, tz) {
  if (!iso) return '';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('DD MMM HH:mm');
}

// Assign a CSS class for percentage display based on value.  Positive
// values are green, negatives red, zero yellow, missing values gray.
function percentClass(value) {
  if (value === null || value === undefined) return 'text-gray-400';
  if (value > 0) return 'text-emerald-500';
  if (value < 0) return 'text-red-500';
  return 'text-amber-500';
}

// Format percent for display.  Adds a plus sign for positive values and
// returns an em dash for missing values.
function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  const rounded = Number(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

// Format price for display.  Returns an em dash for missing values.
function formatPrice(price) {
  if (price === null || price === undefined) return '—';
  return Number(price);
}

// Determine overall trend of a price series: up, down or flat.  Used to
// display a summary label on the card.
function deriveTrend(prices) {
  if (prices.length < 2) return 'unknown';
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

// Given a trend, return a color string (tailwind palette values) for
// use as a stroke or background.
function chartColor(trend) {
  if (trend === 'up') return '#22c55e'; // emerald-500
  if (trend === 'down') return '#ef4444'; // red-500
  if (trend === 'flat') return '#f59e0b'; // amber-500
  return '#9ca3af'; // gray-400
}

/**
 * Build segments for a two‑segment sparkline with color coding.
 * Each segment gets a colour depending on whether the price goes up,
 * down or stays flat.  This allows the sparkline to show direction
 * changes clearly.  The returned array is consumed by the svg
 * renderer below.
 *
 * @param {number[]} prices Array of prices (numbers).
 * @param {number} width    Width of the SVG canvas.
 * @param {number} height   Height of the SVG canvas.
 * @returns {Array<{points: string, color: string}>}
 */
function buildColoredSegments(prices, width = 180, height = 48) {
  const segments = [];
  if (prices.length < 2) return segments;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const step = width / (prices.length - 1);
  const coords = prices.map((price, idx) => {
    const x = idx * step;
    const y = height - ((price - min) / range) * height;
    return { x, y };
  });
  for (let i = 0; i < coords.length - 1; i++) {
    const { x: x1, y: y1 } = coords[i];
    const { x: x2, y: y2 } = coords[i + 1];
    const delta = prices[i + 1] - prices[i];
    let color;
    if (delta > 0) color = '#22c55e';
    else if (delta < 0) color = '#ef4444';
    else color = '#f59e0b';
    segments.push({ points: `${x1},${y1} ${x2},${y2}`, color });
  }
  return segments;
}

export default function PriceReactionCard({ item }) {
  const { title, startAt, type, priceReaction, coinName, timezone, pair } = item;
  // Extract numeric price points for the sparkline
  const pricePoints = priceReaction
    .filter((entry) => entry.price !== null && entry.price !== undefined)
    .map((entry) => Number(entry.price));
  const trend = deriveTrend(pricePoints);
  const coloredSegments = buildColoredSegments(pricePoints);

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-sm dark:border-white/10">
      {/* Header badges: completion and type */}
      <div className="flex items-center gap-2 text-xs mb-2">
        <span className="rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-0.5 font-semibold">
          Completed
        </span>
        <span className="rounded-full bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200 px-2 py-0.5 font-semibold">
          {type || 'Binance Tournaments'}
        </span>
        {pair && <span className="truncate text-gray-500 dark:text-gray-400">{pair}</span>}
      </div>

      {/* Title and subheading */}
      <h3 className="font-semibold text-base sm:text-lg leading-snug line-clamp-2">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {formatDate(startAt, timezone)}{coinName ? ` · ${coinName}` : ''}
      </p>

      {/* Body: trend indicator, sparkline, and table */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 dark:bg-white/5 divide-y divide-white/5">
        {/* Header row with trend label */}
        <div className="px-4 py-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Price Reaction</span>
          <span className="flex items-center gap-2">
            <span>UTC base</span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: `${chartColor(trend)}20`,
                color: chartColor(trend),
              }}
            >
              {trend === 'up' && '▲'}
              {trend === 'flat' && '▬'}
              {trend === 'down' && '▼'}
              {trend === 'unknown' && '•'}
              <span className="hidden sm:inline">Trend</span>
            </span>
          </span>
        </div>
        {/* Sparkline with color‑coded segments */}
        {coloredSegments.length > 0 && (
          <div className="px-4 py-3">
            <svg viewBox="0 0 180 48" className="w-full h-12">
              {coloredSegments.map((seg, idx) => (
                <polyline
                  key={idx}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={seg.points}
                />
              ))}
            </svg>
          </div>
        )}
        {/* Price rows */}
        <div className="divide-y divide-white/5">
          {priceReaction.map((entry) => (
            <div
              key={entry.label}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="w-14 font-mono text-xs text-gray-500 dark:text-gray-400">
                  {formatTime(entry.time, timezone)}
                </span>
                <span className="text-gray-900 dark:text-gray-100 font-medium">
                  {formatPrice(entry.price)}
                </span>
              </div>
              <div className={`font-semibold ${percentClass(entry.percent)}`}>
                {formatPercent(entry.percent)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}