import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ_MAP = {
  Kyiv: 'Europe/Kyiv',
};

function formatTime(iso, tz) {
  if (!iso) return '—';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('HH:mm');
}

function formatDate(iso, tz) {
  if (!iso) return '';
  const base = dayjs.utc(iso);
  const zone = TZ_MAP[tz] || tz || 'UTC';
  return base.tz(zone).format('DD MMM HH:mm');
}

function percentClass(value) {
  if (value === null || value === undefined) return 'text-gray-400';
  if (value > 0) return 'text-emerald-500';
  if (value < 0) return 'text-red-500';
  return 'text-amber-500';
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  const rounded = Number(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function formatPrice(price) {
  if (price === null || price === undefined) return '—';
  return Number(price);
}

export default function PriceReactionCard({ item }) {
  const { title, startAt, type, priceReaction, coinName, timezone, pair } = item;

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-sm dark:border-white/10">
      <div className="flex items-center gap-2 text-xs mb-2">
        <span className="rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-0.5 font-semibold">Completed</span>
        <span className="rounded-full bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200 px-2 py-0.5 font-semibold">{type || 'Binance Tournaments'}</span>
        {pair && <span className="truncate text-gray-500 dark:text-gray-400">{pair}</span>}
      </div>

      <h3 className="font-semibold text-base sm:text-lg leading-snug line-clamp-2">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">{formatDate(startAt, timezone)}{coinName ? ` · ${coinName}` : ''}</p>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 dark:bg-white/5">
        <div className="px-4 py-3 border-b border-white/5 flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Price Reaction</span>
          <span>UTC base</span>
        </div>
        <div className="divide-y divide-white/5">
          {priceReaction.map((entry) => (
            <div key={entry.label} className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-14 font-mono text-xs text-gray-500 dark:text-gray-400">{formatTime(entry.time, timezone)}</span>
                <span className="text-gray-900 dark:text-gray-100 font-medium">{formatPrice(entry.price)}</span>
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