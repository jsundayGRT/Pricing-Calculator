import { emailDecisionToRep, emailEnabled } from './email';
import { getQuoteById } from './quotes';
import { notifyRepInSlack } from './slack';
import { store } from './store';

// How each person wants to hear that their Deal Review was decided. Both are on unless they
// turn one off in the user menu.
export type NotifyPrefs = { email: boolean; slack: boolean };
const PREFS_KEY = 'notify';
const DEFAULT_PREFS: NotifyPrefs = { email: true, slack: true };
const norm = (email: string) => email.trim().toLowerCase();

export async function notifyPrefsFor(email?: string | null): Promise<NotifyPrefs> {
  if (!email) return { ...DEFAULT_PREFS };
  const all = (await store().getValue<Record<string, Partial<NotifyPrefs>>>(PREFS_KEY)) || {};
  return { ...DEFAULT_PREFS, ...all[norm(email)] };
}

export async function setNotifyPrefs(email: string, change: Partial<NotifyPrefs>) {
  const all = (await store().getValue<Record<string, Partial<NotifyPrefs>>>(PREFS_KEY)) || {};
  const next = { ...DEFAULT_PREFS, ...all[norm(email)] };
  if (typeof change.email === 'boolean') next.email = change.email;
  if (typeof change.slack === 'boolean') next.slack = change.slack;
  all[norm(email)] = next;
  await store().putValue(PREFS_KEY, all);
  return next;
}

// Which ways of notifying are set up on this server.
export function notifyAvailable() {
  return { email: emailEnabled(), slack: !!process.env.SLACK_BOT_TOKEN };
}

// Tells the rep their Deal Review was decided: a Slack message from the app (and an email, once
// MAIL_FROM is set up), each only if the rep wants it. Neither ever throws.
export async function notifyRepOfDecision(id: string, appUrl: string) {
  let prefs = { ...DEFAULT_PREFS };
  try {
    prefs = await notifyPrefsFor((await getQuoteById(id))?.ownerEmail);
  } catch (err) {
    console.error('[notify] could not read the rep\'s choices; sending both', err);
  }
  if (prefs.slack) await notifyRepInSlack(id, appUrl);
  if (prefs.email) await emailDecisionToRep(id, appUrl);
}
