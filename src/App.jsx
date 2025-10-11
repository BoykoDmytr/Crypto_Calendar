import { Outlet, Link, } from 'react-router-dom'
import Navbar from './components/Navbar'
import { TG_OWNER_URL, TG_DEV_URL, TG_chanel_URL } from './config'

export default function App(){

  return (
    <div className="max-w-screen-md mx-auto px-3 sm:px-4">
      <Navbar />
      <main className="py-4 sm:py-2">
        <Outlet />
      </main>

      <footer className="py-3 text-center text-xs text-gray-500 space-y-2">
        <div>© {new Date().getFullYear()} Crypto Events Calendar</div>
      </footer>
    </div>
  )
}
