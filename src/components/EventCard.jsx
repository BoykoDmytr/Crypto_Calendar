// src/components/EventCard.jsx
import { useMemo } from 'react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { timeStringToMinutes } from '../utils/time';
import EventTokenInfo from './EventTokenInfo';
import { extractCoinEntries } from '../utils/coins';

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

  // Без конвертацій: показуємо як є (ми вже зберігаємо все в UTC ISO)
  const start = ev?.start_at ? dayjs(ev.start_at) : null;
  const end = ev?.end_at ? dayjs(ev.end_at) : null;

  const tokenEntries = useMemo(() => extractCoinEntries(ev), [ev]);

  // Біржі для TGE
  const tge = Array.isArray(ev?.tge_exchanges) ? [...ev.tge_exchanges] : [];
  tge.sort((a, b) => timeStringToMinutes(a?.time) - timeStringToMinutes(b?.time));

  // ---------- Формуємо підпис дати/часу (БЕЗ року і БЕЗ таймзони) ----------
  let whenLabel = '';

  if (start) {
    if (isTGE) {
      // TGE — дата + (опц.) час
      const hasTime = start.hour() !== 0 || start.minute() !== 0;
      whenLabel = start.format(hasTime ? 'DD MMM HH:mm' : 'DD MMM');
    } else {
      // Чи є реальний час у start/end (не 00:00)
      const hasStartTime = !!start && (start.hour() !== 0 || start.minute() !== 0);
      const hasEndTime = !!end && (end.hour() !== 0 || end.minute() !== 0);

      if (end && !start.isSame(end, 'day')) {
        // Багатоденна: показуємо час біля дати лише якщо він є
        const left = start.format(hasStartTime ? 'DD MMM HH:mm' : 'DD MMM');
        const right = end.format(hasEndTime ? 'DD MMM HH:mm' : 'DD MMM');
        whenLabel = `${left} → ${right}`;
      } else {
        // Один день: якщо часу немає — лише дата
        whenLabel = start.format(hasStartTime ? 'DD MMM HH:mm' : 'DD MMM');

        // Якщо є кінець у той самий день і в нього є час — додаємо діапазон
        if (end && start.isSame(end, 'day') && hasEndTime) {
          whenLabel += ` – ${end.format('HH:mm')}`;
        }
      }
    }
  }

  // Ліва дата для колонки
  const dayNum = start ? start.format('DD') : '';
  const weekday3 = start ? start.format('ddd') : '';

  return (
    <article
      className={`card event-card relative overflow-hidden ${
        isPast ? 'event-card--past' : ''
      }`}
    >
      {/* Кнопка-олівець у правому верхньому куті */}
      <Link
        to={`/suggest/${ev.id}`}
        aria-label="Запропонувати правку"
        title="Запропонувати правку"
        className="glass-icon-btn absolute top-2 right-2 focus:outline-none focus:ring-2 focus:ring-brand-500"      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-current"
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

      <div className="flex gap-3 sm:gap-4">
        {/* Ліва дата + вертикальний акцент */}
        <div className="event-date-col relative">
          <div className="event-date-num">{dayNum}</div>
          <div className="weekday-chip">{weekday3}</div>

          {/* вертикальна смуга-акцент */}
          <div className="event-accent" />
        </div>

        {/* Контент карточки */}
        <div className="flex-1 pr-12">
          <h3 className="event-title">{ev.title}</h3>

          {ev.description && <p className="event-desc mt-1">{ev.description}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {/* тип */}
            <span
              className={`badge-type ${
                /* у темній темі жовтий бейдж для будь-якого типу */ ''
              } ${'badge-type--yellow'}`}
            >
              {ev.type}
            </span>

            {/* дата/час */}
            {whenLabel && (
              <span className="flex items-center gap-1 event-when">
                <span>🕒</span>
                <span>{whenLabel}</span>
              </span>
            )}

            {/* посилання (якщо є) */}
            {ev.link && (
              <a
                className="underline"
                href={ev.link}
                target="_blank"
                rel="noreferrer"
              >
                Лінк
              </a>
            )}
          </div>

          {/* бейджі бірж для TGE */}
          {tge.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {tge.map((x, i) => (
                <span key={`${x?.name || 'ex'}-${i}`} className="exchange-chip">
                  {x?.name}
                  {x?.time ? ` • ${x.time}` : ''}
                </span>
              ))}
            </div>
          )}

          {/* токени + лайв-ціна (Debot/MEXC) */}
          {tokenEntries.length > 0 && <EventTokenInfo coins={tokenEntries} />}

          {nickname && (
            <div className="mt-3 text-sm text-gray-500 dark:text-gray-400 flex justify-end">
              <span>{nickname}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
