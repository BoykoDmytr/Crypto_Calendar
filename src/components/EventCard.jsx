// src/components/EventCard.jsx
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

// "HH:mm" -> хвилини (для сортування біржових часів)
const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  return m ? (+m[1]) * 60 + (+m[2]) : Number.POSITIVE_INFINITY;
};

// чи є реальний час (не 00:00)
const hasTime = (d) => !!d && (d.hour() !== 0 || d.minute() !== 0 || d.second() !== 0);

export default function EventCard({ ev }) {
  const isTGE = ev?.type === 'Listing (TGE)';

  // Без конвертацій: показуємо як є
  const start = ev?.start_at ? dayjs(ev.start_at) : null;
  const end   = ev?.end_at   ? dayjs(ev.end_at)   : null;

  // Біржі для TGE
  const tge = Array.isArray(ev?.tge_exchanges) ? [...ev.tge_exchanges] : [];
  tge.sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));

  // ---------- Формуємо підпис дати/часу (БЕЗ року і БЕЗ таймзони) ----------
  let whenLabel = '';
  let showTime = false;

  if (start) {
    if (isTGE) {
      // TGE — тільки дата
      whenLabel = start.format('DD MMM');
    } else {
      // час опційний ДЛЯ ВСІХ типів: показуємо лише якщо він заданий
      showTime = hasTime(start) || hasTime(end);

      if (end && !start.isSame(end, 'day')) {
        // багатоденна
        const left  = hasTime(start) ? start.format('DD MMM HH:mm') : start.format('DD MMM');
        const right = hasTime(end)   ? end.format('DD MMM HH:mm')   : end.format('DD MMM');
        whenLabel = `${left} → ${right}`;
      } else {
        // один день
        whenLabel = showTime ? start.format('DD MMM HH:mm') : start.format('DD MMM');
      }
    }
  }

  return (
    <article className="card p-4 relative">
      {/* Кнопка-олівець у правому верхньому куті */}
      <Link
        to={`/suggest/${ev.id}`}
        aria-label="Запропонувати правку"
        title="Запропонувати правку"
        className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 bg-white shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-gray-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </Link>

      <h3 className="font-semibold text-lg leading-tight pr-12">{ev.title}</h3>

      {ev.description && (
        <p className="text-sm text-gray-600 mt-1">{ev.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="badge-type">{ev.type}</span>

        {whenLabel && (
          <span className="flex items-center gap-1">
            <span>🕒</span>
            <span>
              {whenLabel}
              {/* якщо один день і час показуємо — додаємо кінець «– HH:mm» */}
              {!isTGE && showTime && end && start?.isSame(end, 'day') && hasTime(end)
                ? ` – ${end.format('HH:mm')}`
                : ''}
            </span>
          </span>
        )}

        {ev.link && (
          <a className="underline" href={ev.link} target="_blank" rel="noreferrer">
            Лінк
          </a>
        )}
      </div>

      {/* бейджі бірж для TGE */}
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
