// src/components/ThemeToggle.jsx
import { useEffect, useState } from "react";

export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      className={[
        "inline-flex items-center justify-center",
        "w-9 h-9 rounded-xl border transition",
        "bg-white hover:bg-gray-50 border-gray-200 text-gray-700",
        "dark:bg-white/10 dark:hover:bg-white/15 dark:border-white/10 dark:text-gray-200",
        className
      ].join(" ")}
    >
      {theme === "dark" ? (
        // Sun icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 4V2M12 22v-2M4.93 4.93 3.52 3.52M20.48 20.48 19.07 19.07M4 12H2M22 12h-2M4.93 19.07 3.52 20.48M20.48 3.52 19.07 4.93M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        // Moon icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}
