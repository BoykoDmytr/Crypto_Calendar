import { useCallback, useEffect, useRef, useState } from 'react'

// Горизонтальний ряд фільтрів.
//
// Той самий компонент лежав ДВОМА байт-у-байт копіями всередині Calendar.jsx
// і Stats.jsx, причому жодна не експортована. Винесено сюди, щоб третя копія
// не з'явилась разом із /creators.
//
// Дві відмінності від тих копій, обидві навмисні:
//  1) відступ під стрілки — проп `pad`. У копіях зашито `px-8 md:px-10`, але
//     стрілки ховаються на мобільному (`hidden md:flex`), і ті 32px лишались
//     порожнечею: на /events перший чіп стоїть на 44px, тоді як лівий край
//     карток — на 12px. Дефолт зберігає стару поведінку, щоб нічого не
//     змістилось на сторінках, які я не чіпаю.
//  2) підказка краю з'являється ЛИШЕ з того боку, де справді лишився
//     прихований контент, і стрілки показуються тільки коли є куди гортати.
//     Постійний туман по краях (як у .nav-scroll) читається як дефект.
export default function FilterScroller({ children, pad = 'px-8 md:px-10' }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdge({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [measure, children])

  // Активний чіп затягуємо у видиму зону вручну через scrollLeft, а не
  // scrollIntoView: останній прокручує ще й СТОРІНКУ, і вхід на /creators
  // з вибраною біржею стрибав би вниз.
  useEffect(() => {
    const el = ref.current
    const on = el && el.querySelector('[data-active="true"]')
    if (!el || !on) return
    const l = on.offsetLeft
    const r = l + on.offsetWidth
    if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 8)
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8
  }, [children])

  const by = (px) => ref.current?.scrollBy({ left: px, behavior: 'smooth' })

  return (
    <div className="relative">
      <div
        ref={ref}
        className={`overflow-x-auto no-scrollbar scroll-smooth flex gap-1.5 sm:gap-2 items-center ${pad}`}
      >
        {children}
      </div>

      {edge.left && <span aria-hidden="true" className="c-edge c-edge--l" />}
      {edge.right && <span aria-hidden="true" className="c-edge c-edge--r" />}

      {edge.left && (
        <button
          type="button"
          onClick={() => by(-240)}
          className="glass-icon-btn hidden md:flex absolute -left-6 top-1/2 -translate-y-1/2
                     items-center justify-center"
          aria-label="Прокрутити ліворуч"
        >
          ‹
        </button>
      )}
      {edge.right && (
        <button
          type="button"
          onClick={() => by(240)}
          className="glass-icon-btn hidden md:flex absolute -right-6 top-1/2 -translate-y-1/2
                     items-center justify-center"
          aria-label="Прокрутити праворуч"
        >
          ›
        </button>
      )}
    </div>
  )
}
