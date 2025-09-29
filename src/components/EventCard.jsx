import dayjs from 'dayjs'


const TypeBadge = ({ type }) => (
<span className="text-xs px-2 py-1 rounded-md bg-gray-100">{type}</span>
)


export default function EventCard({ ev }){
const start = dayjs(ev.start_at)
const end = ev.end_at ? dayjs(ev.end_at) : null
return (
<article className="card p-4 mb-3">
<div className="flex items-start justify-between gap-3">
<div>
<h3 className="font-semibold text-lg leading-tight">{ev.title}</h3>
{ev.description && <p className="text-sm text-gray-600 mt-1">{ev.description}</p>}
<div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
<TypeBadge type={ev.type || 'Other'} />
<span>🕒 {start.format('DD MMM YYYY, HH:mm')} {ev.timezone || 'UTC'}</span>
{end && <span>– {end.format('HH:mm')}</span>}
{ev.location && <span>📍 {ev.location}</span>}
{ev.link && <a className="underline" href={ev.link} target="_blank">Лінк</a>}
</div>
</div>
</div>
</article>
)
}