import { Outlet, Link, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import { TG_OWNER_URL, TG_DEV_URL, TG_chanel_URL } from './config'

export default function App(){
  const { pathname } = useLocation()
  return (
    <div className="max-w-screen-md mx-auto px-3 sm:px-4">
      <Navbar />
      <main className="py-4 sm:py-6">
        <Outlet />
      </main>

      <footer className="py-10 text-center text-xs text-gray-500 space-y-2">
        <div>© {new Date().getFullYear()} Crypto Events Calendar</div>

        {/* навігація, як і було */}
        <div>
          <Link to="/" className={`mr-3 ${pathname==='/'?'font-semibold':''}`}>Календар</Link>
          <Link to="/add" className={`${pathname==='/add'?'font-semibold':''}`}>Додати подію</Link>
        </div>

        {/* новий блок техпідтримки */}
        <div className="flex items-center justify-center gap-3 text-sm">
          <span className="text-gray-400">Техпідтримка:</span>
          <a href={TG_OWNER_URL} target="_blank" rel="noopener noreferrer"
             className="underline underline-offset-2 hover:text-brand-600">
            Адмін
          </a>
          <span>•</span>
          <a href={TG_DEV_URL} target="_blank" rel="noopener noreferrer"
             className="underline underline-offset-2 hover:text-brand-600">
            Розробник
          </a>
          <span>•</span>
          <a href={TG_chanel_URL} target="_blank" rel="noopener noreferrer"
             className="underline underline-offset-2 hover:text-brand-600">
            TG канал
          </a>
        </div>
      </footer>
    </div>
  )
}
