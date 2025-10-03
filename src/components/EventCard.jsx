import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  return (+m[1]) * 60 + (+m[2]);
};

export default function EventCard({ ev }) {
  const isTGE = ev?.type === 'Listing (TGE)';
  const tzLabel = ev?.timezone || 'UTC';

  // без конвертацій
  const start = ev?.start_at ? dayjs(ev.start_at) : null;
  const end   = ev?.end_at   ? dayjs(ev.end_at)   : null;

  // TGE: біржі і часи, відсортовані
  const tge = Array.isArray(ev?.tge_exchanges) ? [...ev.tge_exchanges] : [];
  tge.sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));

  const whenLabel = start
    ? (isTGE
        ? `${start.format('DD MMM YYYY')} ${tzLabel}`  // TGE: без часу
        : `${start.format('DD MMM YYYY, HH:mm')} ${tzLabel}`)
    : '';

  return (
    <article className="card p-4 relative">
      {/* 🔧 Кнопка-олівець у правому верхньому куті */}
      <Link
        to={`/suggest/${ev.id}`}
        aria-label="Запропонувати правку"
        title="Запропонувати правку"
        className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 bg-white shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {/* іконка олівця (inline SVG, без сторонніх бібліотек) */}
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-600" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </Link>

      {/* трошки правого відступу, щоб заголовок не ліз під кнопку */}
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
              {!isTGE && end ? ` – ${end.format('HH:mm')}` : ''}
            </span>
          </span>
        )}

        {ev.link && (
          <a className="underline" href={ev.link} target="_blank" rel="noreferrer">
            Лінк
          </a>
        )}
      </div>

      {/* (прибрали текстове посилання "Запропонувати правку" тут) */}

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
