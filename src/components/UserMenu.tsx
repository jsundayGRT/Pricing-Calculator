'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoonIcon, SunIcon, useTheme } from './theme';

function initials(name: string, email: string) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() || '').join('');
  return letters || email.slice(0, 1).toUpperCase() || '?';
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
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
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = name || email;
  const [theme, toggleTheme] = useTheme();
  const dark = theme === 'dark';

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') || []);

  useEffect(() => {
    if (!open) return;
    // keyboard users land on the first item
    items()[0]?.focus();
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Up / Down / Home / End move between the menu rows
  function onMenuKey(event: React.KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { event.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  }

  return (
    <div className="user-menu" ref={root}>
      <button
        ref={button}
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
        <div className="user-menu-panel" id={menuId} role="menu" aria-label="Account" ref={panel} onKeyDown={onMenuKey}>
          <div className="user-menu-id">
            <span className="user-avatar lg" aria-hidden="true">{initials(name, email)}</span>
            <div className="user-menu-who">
              <strong>{label}</strong>
              {email ? <span className="user-menu-email">{email}</span> : null}
              <span className="user-role">{admin ? 'Admin' : 'Rep'}</span>
            </div>
          </div>
          <div className="user-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={dark}
            className="user-menu-item"
            onClick={toggleTheme}
          >
            <span className="user-menu-icon">{dark ? <MoonIcon /> : <SunIcon />}</span>
            <span>Appearance</span>
            <span className="sr-only">: dark mode</span>
            <span className="user-menu-mode" aria-hidden="true">{dark ? 'Dark' : 'Light'}</span>
            <span className={`mini-switch${dark ? ' on' : ''}`} aria-hidden="true"><span /></span>
          </button>
          {admin ? (
            <a role="menuitem" className="user-menu-item" href="/admin/roles">
              <span className="user-menu-icon"><PeopleIcon /></span>
              <span>Manage roles</span>
            </a>
          ) : null}
          <div className="user-menu-sep" role="separator" />
          <a role="menuitem" className="user-menu-item signout" href="/api/auth/logout">
            <span className="user-menu-icon"><SignOutIcon /></span>
            <span>Sign out</span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
