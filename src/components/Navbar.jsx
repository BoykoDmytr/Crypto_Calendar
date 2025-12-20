import { Link, useLocation } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle'
export default function Navbar() {
  const { pathname } = useLocation();
  const is = (p) => (p === '/' ? pathname === '/' : pathname.startsWith(p));

  const linkClasses = (active) => [
    'nav-link',
    'px-3 py-1 rounded-lg text-sm font-medium',
    active ? 'nav-link--active' : ''
  ].join(' ');

  return (
    <header className="site-header sticky top-0 z-10 border-b backdrop-blur">
       <div className="max-w-screen-md mx-auto px-3 sm:px-4 h-14 flex items-center gap-3 sm:gap-4 justify-between">
        <Link to="/" className="font-semibold text-lg flex items-center gap-1 shrink-0">
          <img src="/icon.png" alt="icon" className="w-4 h-4 inline-block" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-none justify-end min-w-0">
          <div className="nav-scroll">
            <nav
              className="flex items-center gap-2 text-sm min-w-max sm:min-w-0 pr-2 sm:pr-0"
              aria-label="Site sections"
            >
              {/*
              <Link
                className={linkClasses(is('/stats'))}
                to="/stats"
                aria-current={is('/stats') ? 'page' : undefined}
              >
                Статистика
              </Link>
              */}
              {/*
              <Link
                className={linkClasses(is('/admin'))}
                to="/admin"
                aria-current={is('/admin') ? 'page' : undefined}
              >
                Адмін
              </Link>
              */}
              <Link
                className={linkClasses(is('/'))}
                to="/"
                aria-current={is('/') ? 'page' : undefined}
              >
                Календар
              </Link>
              <Link
                className={linkClasses(is('/events'))}
                to="/events"
                aria-current={is('/events') ? 'page' : undefined}
              >
                Івенти
              </Link>
            </nav>
          </div>
          <ThemeToggle />

        </div>
      </div>
      
    </header>
  );
}

//<Link className={`px-3 py-1 rounded-lg ${is('/airdrop') ? 'bg-gray-100' : ''}`} to="/airdrop">Ейрдроп</Link>