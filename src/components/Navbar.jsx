import { Link, useLocation } from 'react-router-dom';

export default function Navbar(){
  const { pathname } = useLocation();
  const is = (p) => (p === pathname) || (p === '/' && pathname === '/'); // активна вкладка

  return (
    <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-100">
      <div className="max-w-screen-md mx-auto px-3 sm:px-4 h-14 flex items-center justify-between">
        <Link to="/" className="font-semibold text-lg">CRYPTO HORNET 🐝</Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link className={`px-3 py-1 rounded-lg ${is('/') ? 'bg-gray-100' : ''}`} to="/">Календар</Link>
          <Link className={`px-3 py-1 rounded-lg ${is('/events') ? 'bg-gray-100' : ''}`} to="/events">Івенти</Link>
          <Link className={`px-3 py-1 rounded-lg ${is('/admin') ? 'bg-gray-100' : ''}`} to="/admin">Адмін</Link>
          <Link to="/add" className="btn hidden sm:inline-flex">+ Додати івент</Link>
        </nav>
      </div>

      {/* Мобільна кнопка під навбаром */}
      <div className="sm:hidden border-t border-gray-100 bg-white">
        <div className="max-w-screen-md mx-auto px-3 py-2">
          <Link to="/add" className="btn w-full">+ Додати івент</Link>
        </div>
      </div>
    </header>
  );
}
