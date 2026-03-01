// src/components/EventCard.jsx
import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { timeStringToMinutes } from '../utils/time';
import EventTokenInfo from './EventTokenInfo';
import { extractCoinEntries } from '../utils/coins';
import { useEventReaction } from '../hooks/useEventReaction';

// Типи, де час НЕобов'язковий (щоб не показувати 00:00)
const TIME_OPTIONAL = new Set([
  'Binance Alpha',
  'OKX Alpha',
  'Token Sales',
  'Claim / Airdrop',
  'Unlocks',
]);

function formatMcapPercent(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.0001) return '<0.0001%';
  if (abs >= 1) return `${n.toFixed(2)}%`;
  if (abs >= 0.1) return `${n.toFixed(3)}%`;
  if (abs >= 0.01) return `${n.toFixed(4)}%`;
  return `${n.toFixed(6).replace(/\.?0+$/, '')}%`;
}

export default function EventCard({ ev, isPast = false }) {
  const isTGE = ev?.type === 'Listing (TGE)';

  // Стейт для відкривання/закривання меню календаря
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Лайки / дизлайки
  const { counts, userReaction, updateReaction } = useEventReaction(ev?.id);

  // Дати
  const start = ev?.start_at ? dayjs(ev.start_at) : null;
  const end = ev?.end_at ? dayjs(ev.end_at) : null;

  const tokenEntries = useMemo(() => extractCoinEntries(ev), [ev]);

  const eventPctMcap = useMemo(() => {
    const eventUsd = Number(ev?.event_usd_value);
    const mcapUsd = Number(ev?.mcap_usd);
    if (!Number.isFinite(eventUsd) || !Number.isFinite(mcapUsd) || mcapUsd <= 0) return null;
    return (eventUsd / mcapUsd) * 100;
  }, [ev?.event_usd_value, ev?.mcap_usd]);

  const eventPctMcapLabel = useMemo(() => formatMcapPercent(eventPctMcap), [eventPctMcap]);

  /* ------------- Логіка для календаря ------------- */

  // Початок події мінус 5 хвилин
  const calendarStart = useMemo(() => {
    if (!start) return null;
    return start.subtract(5, 'minute');
  }, [start]);

  const calendarEnd = start;

  // Форматування дати для GoogleCalendar (UTC)
  const formatGCalDate = (d) => dayjs(d).utc().format('YYYYMMDDTHHmmss[Z]');

  // Посилання на GoogleCalendar
  const gCalLink = useMemo(() => {
    if (!calendarStart || !calendarEnd) return '#';
    const startStr = formatGCalDate(calendarStart);
    const endStr = formatGCalDate(calendarEnd);
    const title = encodeURIComponent(ev?.title || '');
    const details = encodeURIComponent(ev?.description || '');
    const location = encodeURIComponent(ev?.link || '');
    return `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${location}`;
  }, [calendarStart, calendarEnd, ev?.title, ev?.description, ev?.link]);

  // Генерація .ics‑файлу
  const icsContent = useMemo(() => {
    if (!calendarStart || !calendarEnd) return '';
    const startStr = formatGCalDate(calendarStart);
    const endStr = formatGCalDate(calendarEnd);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `SUMMARY:${ev?.title || ''}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      ev?.description ? `DESCRIPTION:${ev.description}` : '',
      ev?.link ? `LOCATION:${ev.link}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.filter(Boolean).join('\r\n');
  }, [calendarStart, calendarEnd, ev?.title, ev?.description, ev?.link]);

  const icsHref = useMemo(() => {
    if (!icsContent) return '#';
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;
  }, [icsContent]);

  /* ------------- Формування відображення дати/часу ------------- */

  let whenLabel = '';
  if (start) {
    if (isTGE) {
      const hasTime = start.hour() !== 0 || start.minute() !== 0;
      whenLabel = start.format(hasTime ? 'DD MMM HH:mm' : 'DD MMM');
    } else {
      const hasStartTime = start.hour() !== 0 || start.minute() !== 0;
      const hasEndTime = end && (end.hour() !== 0 || end.minute() !== 0);
      if (end && !start.isSame(end, 'day')) {
        const left = start.format(hasStartTime ? 'DD MMM HH:mm' : 'DD MMM');
        const right = end.format(hasEndTime ? 'DD MMM HH:mm' : 'DD MMM');
        whenLabel = `${left} → ${right}`;
      } else {
        whenLabel = start.format(hasStartTime ? 'DD MMM HH:mm' : 'DD MMM');
        if (end && hasEndTime) {
          whenLabel += ` – ${end.format('HH:mm')}`;
        }
      }
    }
  }

  const dayNum = start ? start.format('DD') : '';
  const weekday3 = start ? start.format('ddd') : '';

  return (
    <article
      className={`card event-card relative overflow-hidden ${
        isPast ? 'event-card--past' : ''
      }`}
    >
      {/* Кнопка календаря в правому верхньому куті */}
<div className="absolute top-2 right-2 z-50">
  <div className="relative">
    <button
      type="button"
      title="Додати до календаря"
      onClick={() => setCalendarOpen((prev) => !prev)}
      className="glass-icon-btn"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    </button>

      {calendarOpen && (
        <div className="absolute right-0 mt-2 w-max z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <a
            href={gCalLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Google Calendar
          </a>
          <a
            href={icsHref}
            download={`${(ev?.title || 'event').replace(/[^a-zA-Z0-9_-]/g, '_')}.ics`}
            className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Apple / iOS
          </a>
        </div>
      )}
    </div>
  </div>
      {/* Верхня частина картки (дата та контент) */}
      <div className="flex gap-3 sm:gap-4">
        {/* Дата */}
        <div className="event-date-col relative">
          <div className="event-date-num">{dayNum}</div>
          <div className="weekday-chip">{weekday3}</div>
          <div className="event-accent" />
        </div>

        {/* Контент */}
        <div className="flex-1 pr-12">
          <h3 className="event-title">{ev.title}</h3>

          {ev.description && <p className="event-desc mt-1">{ev.description}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="badge-type badge-type--yellow">{ev.type}</span>

            {whenLabel && (
              <span className="flex items-center gap-1 event-when">
                <span>🕒</span>
                <span>{whenLabel}</span>
              </span>
            )}

            {ev.link && (
              <a href={ev.link} target="_blank" rel="noreferrer" className="underline">
                Лінк
              </a>
            )}
          </div>

          {/* Біржі для TGE */}
          {Array.isArray(ev?.tge_exchanges) && ev.tge_exchanges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ev.tge_exchanges
                .slice()
                .sort((a, b) => timeStringToMinutes(a?.time) - timeStringToMinutes(b?.time))
                .map((x, i) => (
                  <span key={i} className="exchange-chip">
                    {x.name}
                    {x.time ? ` • ${x.time}` : ''}
                  </span>
                ))}
            </div>
          )}

          {/* Інформація про токени */}
          {tokenEntries.length > 0 && (
            <EventTokenInfo coins={tokenEntries} pctText={ev?.coin_pct_circ} />
          )}

          {/* Відсоток від капіталізації */}
          {eventPctMcapLabel && (
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              % від MCap: <span className="font-semibold">{eventPctMcapLabel}</span>
            </div>
          )}

          {/* Лайки / дизлайки та календар */}
          <div className="mt-3 flex items-center gap-4">
            {/* DISLIKE */}
            <button
              onClick={() => updateReaction('dislike')}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <img
                src="/dislikef.png"
                alt="Dislike"
                className={`w-4 h-4 ${userReaction === 'dislike' ? 'opacity-100' : 'opacity-40'}`}
              />
              <span className="text-xs tabular-nums">{counts?.dislike ?? 0}</span>
            </button>

            {/* LIKE */}
            <button
              onClick={() => updateReaction('like')}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <img
                src="/likef.png"
                alt="Like"
                className={`w-4 h-4 ${userReaction === 'like' ? 'opacity-100' : 'opacity-40'}`}
              />
              <span className="text-xs tabular-nums">{counts?.like ?? 0}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}