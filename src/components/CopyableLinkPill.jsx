import { useMemo, useState } from 'react';

function deriveDisplayLabel(href) {
  if (!href) return '';
  try {
    const url = new URL(href);
    const segments = url.pathname.split('/').filter(Boolean);
    const tail = segments[segments.length - 1] || url.hostname;
    if (!tail) return url.hostname;
    if (tail.length <= 12) return tail;
    return `${tail.slice(0, 6)}…${tail.slice(-4)}`;
  } catch {
    if (href.length <= 16) return href;
    return `${href.slice(0, 10)}…${href.slice(-4)}`;
  }
}

export default function CopyableLinkPill({ href, label }) {
  const [status, setStatus] = useState('idle');

  const display = useMemo(() => {
    if (label && label.trim()) return label.trim();
    return deriveDisplayLabel(href);
  }, [href, label]);

  if (!href) return null;

  const copyToClipboard = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
        setStatus('copied');
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch (err) {
      console.warn('Failed to copy link', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs text-gray-700 shadow-sm">
      <span className="text-base" aria-hidden="true">
        🔗
      </span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="max-w-[140px] truncate font-medium text-gray-900 hover:underline"
        title={href}
      >
        {display}
      </a>
      <button
        type="button"
        onClick={copyToClipboard}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-gray-500 transition hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
        title={status === 'copied' ? 'Скопійовано!' : 'Скопіювати посилання'}
        aria-label={status === 'copied' ? 'Посилання скопійовано' : 'Скопіювати посилання'}
      >
        {status === 'copied' ? (
          <span className="text-[13px] font-semibold text-green-600">✔</span>
        ) : status === 'error' ? (
          <span className="text-[13px] font-semibold text-red-600">!</span>
        ) : (
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}
