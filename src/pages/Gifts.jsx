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
  { name: '@feeltheglowup', entries: '2х' },
  { name: '@deXyyy1', entries: '5x' },
  { name: '@RayMAN889', entries: '4x' },
  { name: '@Vitamin_kx', entries: '3x' },
  { name: '@vlad280863' },
  { name: '@Iliiyaaa1 ', entries: '3x' },
];

const winners = [
  '@feeltheglowup',
  '@RayMAN889',
  '@Vitamin_kx',
  '@vlad280863',
  '@TonyMontana',
];

const pad = (value) => value.toString().padStart(2, '0');

export default function Gifts() {
  return (
    <section className="relative overflow-hidden py-16 text-center">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        {/* Header */}
        <header className="space-y-3">
          <p className="text-lg text-gray-700 dark:text-slate-300">
            Розіграш завершено! Дякуємо всім за участь і вітаємо переможців.
          </p>
        </header>

        {/* Winners announcement */}
        <div className="mx-auto max-w-3xl rounded-3xl border border-cyan-400/40 bg-white/70 dark:bg-slate-900/70 p-8 text-gray-800 dark:text-white shadow-[0_0_45px_rgba(34,211,238,0.35)] backdrop-blur">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.35em] text-cyan-600 dark:text-cyan-300/90">
            Переможці розіграшу
          </h2>
          <p className="mb-6 text-base text-gray-700 dark:text-slate-200">
            Ось п'ятірка переможців, які отримують по 20 USDT:
          </p>
          <a
            href="https://t.me/cryptohornetchat/60720"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-6 inline-flex items-center justify-center rounded-full border border-cyan-400/50 bg-white/80 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-cyan-700 shadow-[0_0_35px_rgba(34,211,238,0.35)] transition hover:-translate-y-0.5 hover:bg-cyan-50/80 dark:bg-black/40 dark:text-cyan-200"
          >
            Дивитися відео розіграшу
          </a>
          <ul className="grid gap-4 sm:grid-cols-2">
            {winners.map((winner) => (
              <li
                key={winner}
                className="flex items-center justify-center rounded-2xl border border-cyan-400/40 bg-white/60 dark:bg-black/60 px-5 py-4 text-lg font-semibold text-cyan-700 dark:text-cyan-200 shadow-[0_0_35px_rgba(34,211,238,0.45)]"
              >
               {winner}
              </li> 
            ))}
          </ul>
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
