import { Outlet, Link, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'


export default function App(){
const { pathname } = useLocation()
return (
<div className="max-w-screen-md mx-auto px-3 sm:px-4">
<Navbar />
<main className="py-4 sm:py-6">
<Outlet />
</main>
<footer className="py-10 text-center text-xs text-gray-500">
© {new Date().getFullYear()} Crypto Events Calendar
<div className="mt-2">
<Link to="/" className={`mr-3 ${pathname==='/'?'font-semibold':''}`}>Календар</Link>
<Link to="/add" className={`${pathname==='/add'?'font-semibold':''}`}>Додати подію</Link>
</div>
</footer>
</div>
)
}