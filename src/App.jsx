import { Outlet } from 'react-router-dom'
import Navbar from './components/Navbar'

export default function App(){

  return (
    <div className="max-w-screen-md mx-auto px-3 sm:px-4">
      <Navbar />
      <main className="py-4 sm:py-2">
        <Outlet />
      </main>
    </div>
  )
}
