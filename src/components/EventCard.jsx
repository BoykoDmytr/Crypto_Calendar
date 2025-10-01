import dayjs from 'dayjs';

const toMinutes = (s) => {
  if (!s) return Number.POSITIVE_INFINITY;
  const m = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  return (+m[1]) * 60 + (+m[2]);
};

export default function EventCard({ ev }){
  const start = dayjs(ev.start_at);
  const end = ev.end_at ? dayjs(ev.end_at) : null;
  const tge = Array.isArray(ev.tge_exchanges) ? [...ev.tge_exchanges] : [];
  tge.sort((a, b) => toMinutes(a?.time) - toMinutes(b?.time));

  return (
    <article className="card p-4">
      <h3 className="font-semibold text-lg leading-tight">{ev.title}</h3>
      {ev.description && <p className="text-sm text-gray-600 mt-1">{ev.description}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="text-xs px-2 py-1 rounded-md bg-gray-100">{ev.type}</span>
        <span>🕒 {start.format('DD MMM YYYY, HH:mm')} {ev.timezone || 'UTC'}</span>
        {end && <span>– {end.format('HH:mm')}</span>}
        {ev.link && <a className="underline" href={ev.link} target="_blank">Лінк</a>}
      </div>

      {tge.length>0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tge.map((x, i)=> (
            <span key={i} className="text-xs px-2 py-1 rounded-full bg-blue-50 border border-blue-100">
              {x.name}{x.time ? ` • ${x.time}` : ''}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
