import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  return (+m[1]) * 60 + (+m[2]);
};

// Типи, де час НЕобов’язковий (якщо не заданий — не показуємо HH:mm)
const TIME_OPTIONAL = new Set(['Binance Alpha']);

export default function EventCard({ ev }) {
  const isTGE   = ev?.type === 'Listing (TGE)';
  const tzLabel = ev?.timezone || 'UTC';

  // Без конвертацій — усе з БД беремо як є
  const start = ev?.start_at ? dayjs(ev.start_at) : null;
  const end   = ev?.end_at   ? dayjs(ev.end_at)   : null;

  // Чи є «реальний» час у start (а не 00:00)?
  const hasExplicitTime =
    !!start && (start.hour() !== 0 || start.minute() !== 0 || !!end);

  // TGE: біржі і часи, відсортовані
  const tge = Array.isArray(ev?.tge_exchanges) ? [...ev.tge_exchanges] : [];
  tge.sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));

  // Формуємо підпис дати/часу
  let whenLabel = '';
  if (start) {
    if (isTGE) {
      // Для TGE показуємо тільки дату
      whenLabel = `${start.format('DD MMM YYYY')} ${tzLabel}`;
    } else {
      const timeOptional = TIME_OPTIONAL.has(ev?.type);

      // Якщо тип із не обов'язковим часом і його не задано — показуємо лише дату
      const showTime = !timeOptional || hasExplicitTime;

      // Багатоденне в одному рядку (з →)
      if (end && !start.isSame(end, 'day')) {
        whenLabel = showTime
          ? `${start.format('DD MMM YYYY, HH:mm')} ${tzLabel} → ${end.format('DD MMM YYYY, HH:mm')}`
          : `${start.format('DD MMM YYYY')} ${tzLabel} → ${end.format('DD MMM YYYY')}`;
      } else {
        // Один день
        whenLabel = showTime
          ? `${start.format('DD MMM YYYY, HH:mm')} ${tzLabel}`
          : `${start.format('DD MMM YYYY')} ${tzLabel}`;
      }
    }
  }

  return (
    <article className="card p-4 relative">
      {/* 🔧 Кнопка-олівець у правому верхньому куті */}
      <Link
        to={`/suggest/${ev.id}`}
        aria-label="Запропонувати правку"
        title="Запропонувати правку"
        className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 bg-white shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-600" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </Link>

      {/* щоб текст не ліз під кнопку */}
      <h3 className="font-semibold text-lg leading-tight pr-12">{ev.title}</h3>

      {ev.description && (
        <p className="text-sm text-gray-600 mt-1">{ev.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="text-xs px-2 py-1 rounded-md bg-gray-100">{ev.type}</span>

        {whenLabel && (
          <span className="flex items-center gap-1">
            <span>🕒</span>
            <span>
              {whenLabel}
              {/* для одноденних подій з часом можемо додати кінець у форматі  – HH:mm */}
              {!isTGE && end && start?.isSame(end, 'day') && (start.hour() !== 0 || start.minute() !== 0) ? ` – ${end.format('HH:mm')}` : ''}
            </span>
          </span>
        )}

        {ev.link && (
          <a className="underline" href={ev.link} target="_blank" rel="noreferrer">
            Лінк
          </a>
        )}
      </div>

      {tge.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tge.map((x, i) => (
            <span
              key={`${x?.name || 'ex'}-${i}`}
              className="text-xs px-2 py-1 rounded-full bg-blue-50 border border-blue-100"
            >
              {x?.name}{x?.time ? ` • ${x.time}` : ''}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
