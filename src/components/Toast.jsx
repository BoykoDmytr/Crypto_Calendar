import { useEffect } from 'react'
export default function Toast({ text, onClose, ms=2500 }){
useEffect(()=>{
if(!text) return
const t = setTimeout(()=> onClose?.(), ms)
return ()=> clearTimeout(t)
},[text])
if(!text) return null
return (
<div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white px-4 py-2 rounded-xl text-sm shadow-soft">
{text}
</div>
)
}