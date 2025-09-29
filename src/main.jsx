import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import Calendar from './pages/Calendar'
import AddEvent from './pages/AddEvent'
import Admin from './pages/Admin'
import './styles.css'


createRoot(document.getElementById('root')).render(
<React.StrictMode>
<BrowserRouter>
<Routes>
<Route element={<App />}>
<Route index element={<Calendar />} />
<Route path="add" element={<AddEvent />} />
<Route path="admin" element={<Admin />} />
</Route>
</Routes>
</BrowserRouter>
</React.StrictMode>
)