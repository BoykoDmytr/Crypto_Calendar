// src/components/TelegramButtons.jsx
export default function TelegramButtons({
  communityHref = 'https://t.me/+ZlWNBWHBmZIzOTJi',
  chatHref = 'https://t.me/cryptohornetchat',
  okxTrackerHref = 'https://t.me/okxboostcontacttracker',
  tgeTrackerHref = 'https://t.me/tgekeytracker',
}) {
  const buttonClass =
    'inline-flex h-12 min-w-[170px] items-center justify-center gap-2 rounded-2xl px-5 text-lg font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_24px_rgba(37,99,235,0.35)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
  return (
    <div className="w-full flex justify-center">
      <div className="flex w-full max-w-[760px] flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/15 bg-slate-900/30 px-3 py-4 backdrop-blur-sm sm:flex-nowrap sm:px-4">
        <a
          href={communityHref}
          target="_blank"
          rel="noreferrer"
          className={`${buttonClass} bg-gradient-to-b from-blue-500 to-blue-700`}
          aria-label="Open Telegram community"
        >
          <PlaneIcon className="h-5 w-5" />
          <span>Community</span>
        </a>

        <a
          href={chatHref}
          target="_blank"
          rel="noreferrer"
          className={`${buttonClass} bg-gradient-to-b from-blue-500 to-blue-700`}
          aria-label="Open Telegram chat"
        >
          <ChatIcon className="h-5 w-5" />
          <span>Chat</span>
        </a>
        <details className="group relative">
          <summary
            className={`${buttonClass} list-none cursor-pointer bg-gradient-to-b from-blue-500 to-blue-700 [&::-webkit-details-marker]:hidden`}
            aria-label="Open trackers links"
          >
            <TrackerIcon className="h-5 w-5" />
            <span>Trackers</span>
            <ChevronIcon className="h-4 w-4 transition group-open:rotate-180" />
          </summary>

          <div className="absolute right-0 z-20 mt-2 min-w-full overflow-hidden rounded-xl border border-blue-200/30 bg-slate-900/95 shadow-xl">
            <a
              href={okxTrackerHref}
              target="_blank"
              rel="noreferrer"
              className="block px-4 py-2 text-sm text-white transition hover:bg-blue-500/30"
            >
              OKX Tracker
            </a>
            <a
              href={tgeTrackerHref}
              target="_blank"
              rel="noreferrer"
              className="block border-t border-blue-200/20 px-4 py-2 text-sm text-white transition hover:bg-blue-500/30"
            >
              TGE Tracker
            </a>
          </div>
        </details>
      </div>
    </div>
  );
}

/* --- іконки --- */
function PlaneIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M22 2.5 2.9 10.2c-.8.3-.8 1.4 0 1.7l4.8 1.8 1.9 6.1c.2.7 1.1.9 1.6.4l2.8-2.7 4.9 3.6c.6.4 1.4.1 1.6-.6L23.9 3.3c.2-.9-.7-1.6-1.5-1.3zM18.1 6l-8.6 7 1 3.3.7-2.1 6.9-8.2z" />
    </svg>
  );
}
function ChatIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4.5 3.4A1 1 0 0 1 3 19.6V6a2 2 0 0 1 1-2z" />
    </svg>
  );
}
function TrackerIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="m21 3-6 6" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden="true">
      <path d="M5.2 7.6a1 1 0 0 1 1.4 0L10 11l3.4-3.4a1 1 0 0 1 1.4 1.4l-4.1 4.1a1 1 0 0 1-1.4 0L5.2 9a1 1 0 0 1 0-1.4z" />
    </svg>
  );
}