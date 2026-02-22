import { Outlet } from 'react-router-dom'
import Navbar from './components/Navbar'

const resources = [
  {
    href: 'https://t.me/tgekeytracker',
    title: 'PRIME-TGE Key Tracker 🔑',
  },
  {
    href: 'https://t.me/okxboostcontacttracker',
    title: 'OKX Boost Contract Tracker',
  },
  {
    href: 'https://t.me/cryptohornettg',
    title: 'CRYPTO HORNET(Наша група і чат)',
  },
]

export default function App(){

  return (
    <div className="max-w-screen-md mx-auto px-3 sm:px-4">
      <Navbar />
      <main className="py-4 sm:py-2">
        <Outlet />
      </main>

      <footer className="py-5 text-center text-xs text-gray-500 space-y-3 border-t border-gray-200/80 dark:border-slate-700/70">
        <div className="rounded-2xl border border-brand-200/60 dark:border-brand-500/40 bg-gradient-to-br from-brand-50 to-white dark:from-slate-800 dark:to-slate-900 p-3 sm:p-4 text-left shadow-sm">
          <p className="text-xs uppercase tracking-wide text-brand-700 dark:text-brand-300 font-semibold mb-2">
            Наші Telegram ресурси
          </p>
          <div className="space-y-2">
            {resources.map((resource) => (
              <a
                key={resource.href}
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm text-gray-700 dark:text-slate-100 hover:bg-brand-50 dark:hover:bg-slate-700 transition-colors"
              >
                <span>{resource.title}</span>
                <span className="text-brand-600 dark:text-brand-300 font-medium">Підписатись →</span>
              </a>
            ))}
          </div>
        </div>
        <div>© {new Date().getFullYear()} Crypto Events Calendar</div>
      </footer>
    </div>
  )
}
