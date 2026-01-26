// src/components/EventCard.jsx
import { useMemo } from 'react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
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

export default function EventCard({ ev, isPast = false }) {
  const isTGE = ev?.type === 'Listing (TGE)';
  const nicknameRaw = (ev?.nickname || '').trim();
  const nickname = nicknameRaw
    ? nicknameRaw.startsWith('@')
      ? nicknameRaw
      : `@${nicknameRaw}`
    : '';

  // 🔥 Лайки / дизлайки
  const { counts, userReaction, updateReaction } = useEventReaction(ev?.id);

  // Без конвертацій
  const start = ev?.start_at ? dayjs(ev.start_at) : null;
  const end = ev?.end_at ? dayjs(ev.end_at) : null;

  const tokenEntries = useMemo(() => extractCoinEntries(ev), [ev]);

  // Біржі для TGE
  const tge = Array.isArray(ev?.tge_exchanges) ? [...ev.tge_exchanges] : [];
  tge.sort((a, b) => timeStringToMinutes(a?.time) - timeStringToMinutes(b?.time));

  // ---------- Формуємо підпис дати/часу ----------
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
      {/* Кнопка правки */}
      <Link
        to={`/suggest/${ev.id}`}
        title="Запропонувати правку"
        className="glass-icon-btn absolute top-2 right-2"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </Link>

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

          {tge.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {tge.map((x, i) => (
                <span key={i} className="exchange-chip">
                  {x.name}{x.time ? ` • ${x.time}` : ''}
                </span>
              ))}
            </div>
          )}

          {tokenEntries.length > 0 && <EventTokenInfo coins={tokenEntries} />}

          {/* 🔥 ЛАЙКИ / ДИЗЛАЙКИ */}
          <div className="mt-3 flex items-center gap-4">
            {/* DISLIKE */}
            <button
              onClick={() => updateReaction('dislike')}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <img
                src="/dislike.png"
                alt="Dislike"
                className={`w-4 h-4 ${
                  userReaction === 'dislike' ? 'opacity-100' : 'opacity-40'
                }`}
              />
              <span className="text-xs tabular-nums">
                {counts?.dislike ?? 0}
              </span>
            </button>

            {/* LIKE */}
            <button
              onClick={() => updateReaction('like')}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <img
                src="/like.png"
                alt="Like"
                className={`w-4 h-4 ${
                  userReaction === 'like' ? 'opacity-100' : 'opacity-40'
                }`}
              />
              <span className="text-xs tabular-nums">
                {counts?.like ?? 0}
              </span>
            </button>

            {/* Нікнейм справа */}
            {nickname && (
              <div className="ml-auto text-sm text-gray-500 dark:text-gray-400">
                {nickname}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
