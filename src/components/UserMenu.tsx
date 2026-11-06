'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoonIcon, SunIcon, useTheme } from './theme';

function initials(name: string, email: string) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() || '').join('');
  return letters || email.slice(0, 1).toUpperCase() || '?';
}

export function UserMenu({
  name,
  email,
  admin,
}: {
  name: string;
  email: string;
  admin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = name || email;
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button
        type="button"
        className="user-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="user-avatar" aria-hidden="true">{initials(name, email)}</span>
        <span className="user-menu-name">{label}</span>
        <svg className="user-menu-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div className="user-menu-panel" id={menuId} role="menu" aria-label="Account">
          <div className="user-menu-id">
            <strong>{label}</strong>
            {email ? <span>{email}</span> : null}
            {admin ? <span className="user-role">Admin</span> : null}
          </div>
          <button type="button" role="menuitem" className="theme-row" onClick={toggleTheme}>
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
            <span>{theme === 'light' ? 'Light' : 'Dark'} now</span>
          </button>
          <a role="menuitem" href="/api/auth/logout">Sign out</a>
        </div>
      ) : null}
    </div>
  );
}
