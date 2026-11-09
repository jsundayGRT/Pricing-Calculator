'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoonIcon, SunIcon, useTheme } from './theme';

function initials(name: string, email: string) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() || '').join('');
  return letters || email.slice(0, 1).toUpperCase() || '?';
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" />
    </svg>
  );
}

type Channel = 'email' | 'slack';
type Notify = { prefs: Record<Channel, boolean>; available: Record<Channel, boolean> };

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
  const [notify, setNotify] = useState<Notify | null>(null);

  // how this person hears about Deal Review decisions, loaded the first time the menu opens
  useEffect(() => {
    if (!open || notify) return;
    fetch('/api/me/notifications', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Notify | null) => { if (data?.prefs) setNotify(data); })
      .catch(() => { /* the switches stay hidden */ });
  }, [open, notify]);

  async function toggleNotify(channel: Channel) {
    if (!notify || !notify.available[channel]) return;
    const value = !notify.prefs[channel];
    setNotify({ ...notify, prefs: { ...notify.prefs, [channel]: value } });
    try {
      const res = await fetch('/api/me/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [channel]: value }),
      });
      if (!res.ok) throw new Error();
      setNotify(await res.json());
    } catch {
      setNotify((n) => (n ? { ...n, prefs: { ...n.prefs, [channel]: !value } } : n));
    }
  }

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
          {notify ? (
            <>
              <div className="user-menu-sep" role="separator" />
              <div className="user-menu-label" aria-hidden="true">Deal Review decisions</div>
              {([['email', 'By email', <MailIcon key="m" />], ['slack', 'In Slack', <ChatIcon key="c" />]] as const).map(([channel, label, icon]) => {
                const ready = notify.available[channel], on = ready && notify.prefs[channel];
                return (
                  <button
                    key={channel}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    aria-disabled={!ready || undefined}
                    className="user-menu-item"
                    onClick={() => void toggleNotify(channel)}
                  >
                    <span className="user-menu-icon">{icon}</span>
                    <span>{label}</span>
                    <span className="sr-only">: tell me when my Deal Review is decided{ready ? '' : ' (not set up)'}</span>
                    <span className="user-menu-mode" aria-hidden="true">{ready ? (on ? 'On' : 'Off') : 'Not set up'}</span>
                    {ready ? <span className={`mini-switch${on ? ' on' : ''}`} aria-hidden="true"><span /></span> : null}
                  </button>
                );
              })}
            </>
          ) : null}
          <div className="user-menu-sep" role="separator" />
          <a role="menuitem" className="user-menu-item" href="/help">
            <span className="user-menu-icon"><HelpIcon /></span>
            <span>Help &amp; feedback</span>
          </a>
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
