// src/components/TelegramButtons.jsx
export default function TelegramButtons({
  communityHref = "https://t.me/+ZlWNBWHBmZIzOTJi", // канал
  chatHref = "https://t.me/+CT9AnmGvQmc2OWIy",      // чат
}) {
  return (
    <div className="w-full flex justify-center">
      {/* на мобілці вузький контейнер і менші відступи */}
      <div className="grid grid-cols-2 gap-1 w-full max-w-[300px] sm:max-w-sm">
        <a
          href={communityHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full
                     px-2.5 py-1.5 rounded-lg text-xs text-white
                     sm:px-3 sm:py-2 sm:rounded-xl sm:text-sm
                     bg-brand-600 hover:bg-brand-700 active:scale-[.99]
                     shadow-sm ring-1 ring-brand-600/20
                     focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Приєднатись до Telegram community"
        >
          <PlaneIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Community</span>
        </a>

        <a
          href={chatHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full
                     px-2.5 py-1.5 rounded-lg text-xs text-white
                     sm:px-3 sm:py-2 sm:rounded-xl sm:text-sm
                     bg-brand-600 hover:bg-brand-700 active:scale-[.99]
                     shadow-sm ring-1 ring-brand-600/20
                     focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Відкрити Telegram chat"
        >
          <ChatIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Chat</span>
        </a>
      </div>
    </div>
  );
}

/* --- іконки --- */
function PlaneIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M22 2.5 2.9 10.2c-.8.3-.8 1.4 0 1.7l4.8 1.8 1.9 6.1c.2.7 1.1.9 1.6.4l2.8-2.7 4.9 3.6c.6.4 1.4.1 1.6-.6L23.9 3.3c.2-.9-.7-1.6-1.5-1.3zM18.1 6l-8.6 7 1 3.3.7-2.1 6.9-8.2z" />
    </svg>
  );
}
function ChatIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4.5 3.4A1 1 0 0 1 3 19.6V6a2 2 0 0 1 1-2z" />
    </svg>
  );
}