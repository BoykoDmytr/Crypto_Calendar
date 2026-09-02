import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
export default function Navbar() {
  const { pathname } = useLocation();
  const is = (p) => (p === '/' ? pathname === '/' : pathname.startsWith(p));

  // Активний пункт затягуємо у видиму зону: на 320px «Креатори» — останній із
  // чотирьох — стоїть на 359px і просто не видно, куди ти зайшов. Рухаємо
  // scrollLeft самої стрічки, а не scrollIntoView, бо той тягне ще й сторінку.
  const trackRef = useRef(null);
  useEffect(() => {
    const el = trackRef.current;
    const on = el && el.querySelector('.nav-link--active');
    if (!el || !on) return;
    const l = on.offsetLeft;
    const r = l + on.offsetWidth;
    if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 8);
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8;
  }, [pathname]);

  const linkClasses = (active) => [
    'nav-link',
    'px-3 py-1 rounded-lg text-sm font-medium',
    active ? 'nav-link--active' : ''
  ].join(' ');

  return (
    <header className="site-header sticky top-0 z-10 border-b backdrop-blur">
       {/* Без власного max-w/px: точно такий самий контейнер уже дає App.jsx,
           і вкладений дублікат з’їдав 24px — рівно через них активний
           пункт «Креатори» вилазив за праву межу хедера і зрізався. */}
       <div className="h-14 flex items-center gap-3 sm:gap-4 justify-between">
        <Link to="/" className="font-semibold text-lg flex items-center gap-1 shrink-0">
          <img src="/icon.png" alt="icon" className="w-4 h-4 inline-block" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-none justify-end min-w-0">
          <div className="nav-scroll" ref={trackRef}>
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
              <Link
                className={linkClasses(is('/live'))}
                to="/live"
                aria-current={is('/live') ? 'page' : undefined}
              >
                Live
              </Link>
              <Link
                className={linkClasses(is('/creators'))}
                to="/creators"
                aria-current={is('/creators') ? 'page' : undefined}
              >
                Креатори
              </Link>
              {/* Клейми переїхали у приховану сторінку /live (вкладка всередині) */}
            </nav>
          </div>
        </div>
      </div>
      
    </header>
  );
}