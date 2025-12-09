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
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const rounded = Number(numeric.toFixed(5));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized}%`;
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
function buildColoredSegments(prices, width = 240, height = 64) {
  const segments = [];
  const points = [];
  if (prices.length < 2) return { segments, points };
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
  return { segments, points: coords };
}

function calcOverallChange(base, next) {
  if (base == null || next == null) return null;
  const b = Number(base);
  const n = Number(next);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b === 0) return null;
  return ((n - b) / b) * 100;
}

export default function PriceReactionCard({ item }) {
  const { title, startAt, type, priceReaction, coinName, timezone, pair } = item;
  // Extract numeric price points for the sparkline
  const pricePoints = priceReaction
    .filter((entry) => entry.price !== null && entry.price !== undefined)
    .map((entry) => Number(entry.price));
  const trend = deriveTrend(pricePoints);
  const { segments: coloredSegments, points } = buildColoredSegments(pricePoints);
  const overallChange =
    pricePoints.length >= 2 ? calcOverallChange(pricePoints[0], pricePoints[pricePoints.length - 1]) : null;

  const sparkWidth = 240;
  const sparkHeight = 64;

  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-[#171a22] via-[#0f1119] to-[#0b0d13] px-4 py-4 shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#2dd4bf0d,transparent_45%)]" aria-hidden />
      {/* Header badges: completion and type */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold mb-3">
        <span className="rounded-full bg-emerald-500/15 text-emerald-200 px-2.5 py-1 border border-emerald-500/20">
          Completed
        </span>
        <span className="rounded-full bg-white/5 text-gray-200 px-2.5 py-1 border border-white/10">
          {type || 'Binance Tournaments'}
        </span>
        {pair && <span className="truncate text-gray-400 max-w-full sm:max-w-none">{pair}</span>}
      </div>

      {/* Title and subheading */}
      <div className="flex flex-col gap-1 mb-3">
        <h3 className="font-semibold text-base sm:text-lg leading-snug text-white line-clamp-2 break-words">{title}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-400">
          <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide">UTC</span>
          <span className="whitespace-nowrap">{formatDate(startAt, timezone)}</span>
          {coinName && <span className="text-gray-300">· {coinName}</span>}
        </div>
      </div>

      {/* Body: trend indicator, sparkline, and table */}
      <div className="rounded-xl border border-white/5 bg-white/10 backdrop-blur-sm divide-y divide-white/5 overflow-hidden">
        {/* Header row with trend label */}
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="uppercase tracking-wide text-[11px] text-gray-500">Price reaction</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 border border-white/10 text-[11px]">T0 → T+15m</span>
          </div>
          {overallChange !== null && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold"
              style={{
                backgroundColor: `${chartColor(trend)}20`,
                color: chartColor(trend),
              }}
            >
              {overallChange > 0 && '▲'}
              {overallChange === 0 && '▬'}
              {overallChange < 0 && '▼'}
              {formatPercent(overallChange)}
            </span>
            )}
        </div>
        {/* Sparkline with color‑coded segments */}
        {coloredSegments.length > 0 && (
          <div className="px-4 py-4 bg-black/10">{
            /* background grid */
          }
            <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} className="w-full h-16">
              <defs>
                <linearGradient id="sparklineGradient" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="100%" height="100%" fill="url(#sparklineGradient)" rx="8" />
              {coloredSegments.map((seg, idx) => (
                <polyline
                  key={idx}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={seg.points}
                />
              ))}
              {points.map((pt, idx) => (
                <g key={idx}>
                  <circle cx={pt.x} cy={pt.y} r="3.5" fill="#0b0d13" stroke="#1f2937" strokeWidth="1.5" />
                  <circle cx={pt.x} cy={pt.y} r="2.5" fill="#c4c9ff" />
                </g>
              ))}
            </svg>
          </div>
        )}
        {/* Price rows */}
        <div className="divide-y divide-white/5 bg-black/20">
          {priceReaction.map((entry) => (
            <div
              key={entry.label}
              className="grid grid-cols-[72px,1fr] sm:grid-cols-[72px,1fr,90px] items-start gap-2 sm:gap-3 px-4 py-3 text-xs sm:text-sm text-gray-200"
            >
              <div className="flex items-center gap-2">
                <span className="w-16 rounded-full bg-white/5 px-2 py-1 text-center text-[11px] uppercase tracking-wide text-gray-300 border border-white/10">
                  {entry.label}
                </span>
              </div>
               <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="w-14 font-mono text-[11px] sm:text-xs text-gray-400">{formatTime(entry.time, timezone)}</span>
                <span className="text-white font-semibold break-words">{formatPrice(entry.price)}</span>
                <span className={`sm:hidden ml-auto font-semibold ${percentClass(entry.percent)}`}>
                  {formatPercent(entry.percent)}
                </span>
              </div>
              <div className={`hidden sm:block text-right font-semibold ${percentClass(entry.percent)}`}>
                {formatPercent(entry.percent)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}