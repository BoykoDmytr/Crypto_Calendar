import { useEffect, useMemo, useState } from 'react';

const participants = [
  { name: '@palladium07', entries: '5х' },
  { name: '@TonyMontana', entries: '2х' },
  { name: '@neomaster3' },
  { name: '@crypto_oleksiy' },
  { name: '@Mhaelko' },
  { name: '@Hayduchok_Ihor', entries: '3х' },
  { name: '@shved21' },
  { name: '@prohor' },
  { name: '@ANDRIY0910', entries: '5х' },
  { name: '@ara_DokS', entries: '3х' },
  { name: '@feeltheglowup', entries: '2х'},
  { name: '@Iliiyaaa1' },
  { name: '@deXyyy1', entries: '5x'},
  { name: '@RayMAN889', entries: '4x'},
  { name: '@Vitamin_kx', entries: '3x'},
  { name: '@vlad280863' },
  { name: '@Iliiyaaa1 ', entries: '3x'},
];

const createTargetDate = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const target = new Date(currentYear, 10, 16, 0, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setFullYear(currentYear + 1);
  }

  return target;
};

const getTimeLeft = (targetDate) => {
  const total = targetDate.getTime() - new Date().getTime();
  const clamped = Math.max(total, 0);

  const days = Math.floor(clamped / (1000 * 60 * 60 * 24));
  const hours = Math.floor((clamped / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((clamped / (1000 * 60)) % 60);
  const seconds = Math.floor((clamped / 1000) % 60);

  return {
    total,
    days,
    hours,
    minutes,
    seconds,
  };
};

const pad = (value) => value.toString().padStart(2, '0');

export default function Gifts() {
  const targetDate = useMemo(createTargetDate, []);
  const [timeLeft, setTimeLeft] = useState(getTimeLeft(targetDate));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(targetDate));
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  const isFinished = timeLeft.total <= 0;

  return (
    <section className="relative overflow-hidden py-16 text-center">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        {/* Header */}
        <header className="space-y-3">
          <p className="text-lg text-gray-700 dark:text-slate-300">
            Встигніть додати подію та виграти 100 USDT до головного розіграшу 16 листопада.
          </p>
        </header>

        {/* Countdown timer container */}
        <div className="mx-auto max-w-3xl rounded-3xl border border-cyan-400/40 bg-white/70 dark:bg-slate-900/70 p-8 text-gray-800 dark:text-white shadow-[0_0_45px_rgba(34,211,238,0.35)] backdrop-blur">
          <h2 className="mb-6 text-sm font-semibold uppercase tracking-[0.35em] text-cyan-600 dark:text-cyan-300/90">
            До розіграшу залишилося
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {[
              { label: 'Дні', value: timeLeft.days.toString() },
              { label: 'Години', value: pad(timeLeft.hours) },
              { label: 'Хвилини', value: pad(timeLeft.minutes) },
              { label: 'Секунди', value: pad(timeLeft.seconds) },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="neon-timer-card flex h-28 w-28 flex-col items-center justify-center rounded-2xl border border-cyan-400/30 bg-white/60 dark:bg-black/60 text-center shadow-[0_0_35px_rgba(34,211,238,0.45)] transition hover:shadow-[0_0_45px_rgba(34,211,238,0.8)]"
              >
                <span className="text-4xl font-bold text-cyan-600 dark:text-cyan-300 drop-shadow-[0_0_25px_rgba(34,211,238,0.3)] dark:drop-shadow-[0_0_25px_rgba(34,211,238,0.8)]">
                  {value}
                </span>
                <span className="mt-1 text-xs uppercase tracking-[0.3em] text-cyan-600/90 dark:text-cyan-100/90">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {isFinished && (
            <p className="mt-6 text-sm font-medium text-emerald-600 dark:text-emerald-300 drop-shadow-[0_0_15px_rgba(16,185,129,0.45)] dark:drop-shadow-[0_0_15px_rgba(16,185,129,0.65)]">
              Розіграш вже розпочався — слідкуйте за оновленнями у Telegram!
            </p>
          )}
        </div>

        {/* Contest rules */}
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-300/60 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/60 p-8 text-left text-gray-800 dark:text-slate-100 shadow-[0_0_35px_rgba(15,23,42,0.3)] dark:shadow-[0_0_35px_rgba(15,23,42,0.6)] backdrop-blur">
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">Умови розіграшу</h2>
          <ol className="space-y-4 text-base leading-relaxed">
            <li>
              <span className="font-semibold text-cyan-600 dark:text-cyan-300">1.</span> Коли додаєте новий івент, обов'язково вказуйте свій нік у
              Telegram. Немає ніку — подія не бере участі в розіграші.
            </li>
            <li>
              <span className="font-semibold text-cyan-600 dark:text-cyan-300">2.</span> Після перевірки адмінами ваша подія з'явиться в календарі,
              і ви автоматично візьмете участь у розіграші USDT.
            </li>
            <li>
              <span className="font-semibold text-cyan-600 dark:text-cyan-300">3.</span> Чим більше івентів ви додаєте, тим вищі шанси на перемогу
              (але не більше 5 подій).
            </li>
            <li>
              <span className="font-semibold text-cyan-600 dark:text-cyan-300">4.</span> У разі виграшу ми зв'яжемося з вами у вказаному Telegram
              16 листопада.
            </li>
            <li>
              <span className="font-semibold text-cyan-600 dark:text-cyan-300">5.</span> Всього буде 5 переможців по 20 USDT.
            </li>
          </ol>
        </div>

          {/* Participants */}
        <div className="mx-auto max-w-3xl rounded-3xl border border-cyan-400/40 bg-white/60 dark:bg-slate-900/60 p-8 text-left text-gray-800 dark:text-slate-100 shadow-[0_0_35px_rgba(34,211,238,0.35)] dark:shadow-[0_0_35px_rgba(34,211,238,0.55)] backdrop-blur">
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">Учасники розіграшу</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {participants.map(({ name, entries }) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-2xl border border-cyan-400/30 bg-white/70 dark:bg-slate-950/50 px-5 py-3 text-base font-medium text-cyan-700 dark:text-cyan-200 shadow-[0_0_25px_rgba(34,211,238,0.25)]"
              >
                <span>{name}</span>
                {entries ? (
                  <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-100">
                    {entries}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

      </div>
    </section>
  );
}
