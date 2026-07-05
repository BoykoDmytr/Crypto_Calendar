import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import MonthCalendar from './pages/MonthCalendar';
import Calendar from './pages/Calendar';
import AddEvent from './pages/AddEvent';
import Admin from './pages/Admin';
import './styles.css';
import SuggestEdit from './pages/SuggestEdit';
import AirdropTracker from './pages/AirdropTracker';
import Gifts from './pages/Gifts';
import Stats from './pages/Stats';
import Claims from './pages/Claims';
import Live from './pages/Live';

// ✅ Vercel Analytics + Speed Insights для будь-якого SPA
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'

// у продакшені, щоб не смітити у локальній розробці
if (import.meta.env.PROD) {
  inject();
  injectSpeedInsights();
}

const root = document.documentElement;
root.classList.add('dark');
localStorage.setItem('theme', 'dark');

// NOTE: a single root is mounted below via RouterProvider. (A second, stray
// createRoot(<App/>) used to run here without a Router, which made Navbar's
// useLocation() throw on every load — removed.)

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <MonthCalendar /> }, // ГОЛОВНА = КАЛЕНДАР
      { path: 'events', element: <Calendar /> },   // Лістинг як “Івенти”
      { path: 'add', element: <AddEvent /> },
      { path: 'admin', element: <Admin /> },
      { path: 'suggest/:id', element: <SuggestEdit /> },
      { path: 'airdrop', element: <AirdropTracker /> },
      { path: 'gifts', element: <Gifts /> },
      { path: 'stats', element: <Stats /> },
      { path: 'claims', element: <Claims /> },
      { path: 'live', element: <Live /> }, // прихована сторінка — без лінка в навбарі

    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);