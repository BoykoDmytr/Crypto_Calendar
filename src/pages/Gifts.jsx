
const winners = [
  '@feeltheglowup',
  '@RayMAN889',
  '@Vitamin_kx',
  '@vlad280863',
  '@TonyMontana',
];

export default function Gifts() {
  return (
    <section className="relative overflow-hidden py-16 text-center">
      <div className="mx-auto max-w-3xl space-y-10 px-4">
        <header className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Історія розіграшу</h1>
          <p className="text-lg text-gray-700 dark:text-slate-300">
            Розіграш USDT завершився 16 листопада. Дякуємо всім, хто долучився, і вітаємо
            переможців!
          </p>
        </header>

        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-300/60 dark:border-slate-700/60 bg-white/70 dark:bg-slate-900/70 p-8 text-gray-800 dark:text-white shadow-[0_0_35px_rgba(15,23,42,0.25)] dark:shadow-[0_0_35px_rgba(15,23,42,0.55)] backdrop-blur">
          <div className="mb-6 space-y-2">
            <p className="text-sm uppercase tracking-[0.28em] text-cyan-600 dark:text-cyan-300/90">Результати</p>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Переможці отримали по 20 USDT</h2>
            <p className="text-base text-gray-700 dark:text-slate-200">
              Запис прямих ефірів та проведення можна переглянути в Telegram.
            </p>
          </div>
          <a
            href="https://t.me/cryptohornetchat/60720"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-8 inline-flex items-center justify-center rounded-full border border-cyan-400/50 bg-white/80 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-cyan-700 shadow-[0_0_30px_rgba(34,211,238,0.28)] transition hover:-translate-y-0.5 hover:bg-cyan-50/80 dark:bg-black/40 dark:text-cyan-200"
          >
            Дивитися відео розіграшу
          </a>
          <ul className="grid gap-3 sm:grid-cols-2">
            {winners.map((winner) => (
              <li
                key={winner}
                className="flex items-center justify-center rounded-2xl border border-cyan-400/30 bg-white/70 dark:bg-black/50 px-5 py-4 text-lg font-semibold text-cyan-700 dark:text-cyan-200 shadow-[0_0_25px_rgba(34,211,238,0.3)]"
              >
                {winner}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
