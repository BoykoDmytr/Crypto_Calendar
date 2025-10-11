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

// ✅ Vercel Analytics + Speed Insights для будь-якого SPA
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'

// у продакшені, щоб не смітити у локальній розробці
if (import.meta.env.PROD) {
  inject();
  injectSpeedInsights();
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)


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
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);