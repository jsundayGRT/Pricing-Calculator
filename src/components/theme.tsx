'use client';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'grt-theme';

// Runs in <head> before the page paints, so a light-mode page never flashes dark. Light is the
// default; dark only once someone picks it.
export const THEME_BOOT = `try{if(localStorage.getItem('${KEY}')!=='dark')document.documentElement.dataset.theme='light'}catch(e){document.documentElement.dataset.theme='light'}`;

function current(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(KEY, theme); } catch { /* private window: this page only */ }
  // the calculator runs in a frame on the same site; switch it too
  document.querySelectorAll('iframe.calc-frame').forEach((frame) => {
    (frame as HTMLIFrameElement).contentDocument?.documentElement.classList.toggle('light', theme === 'light');
  });
  window.dispatchEvent(new CustomEvent(KEY, { detail: theme }));
}

// The current theme, kept in step between the header button and the user menu.
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    setTheme(current());
    const onChange = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener(KEY, onChange);
    return () => window.removeEventListener(KEY, onChange);
  }, []);
  return [theme, () => apply(current() === 'light' ? 'dark' : 'light')];
}

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

// Round button left of the Role chip: shows the mode you'd switch to.
export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  return (
    <button type="button" className="theme-btn" onClick={toggle} title={label} aria-label={label}>
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
