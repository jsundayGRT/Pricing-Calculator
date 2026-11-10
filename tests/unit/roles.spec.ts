import { expect, test } from '@playwright/test';
import { isAdmin, listPeople, recordSeen, recordSignIn, removePerson, roleForEmail, RoleError, setRole } from '../../src/lib/admin';
import { store } from '../../src/lib/store';
import { recordActivity } from '../../src/lib/activity';
import { upsertQuote } from '../../src/lib/quotes';
import { setStoreForTests, type Store } from '../../src/lib/store';

// Roles against an in-memory store.

function memoryStore(): Store {
  const quotes = new Map<string, { id: string }>(), values = new Map<string, string>(), events: unknown[] = [];
  return {
    async all<T>() { return [...quotes.values()] as T[]; },
    async get<T>(id: string) { return (quotes.get(id) as T) || null; },
    async put(record) { quotes.set(record.id, record); },
    async remove(id) { return quotes.delete(id); },
    async putPdf() {},
    async getPdf() { return null; },
    async removePdf() {},
    async addEvent(event) { events.unshift(event); },
    async events<T>() { return events as T[]; },
    async getValue<T>(key: string) { const raw = values.get(key); return raw ? (JSON.parse(raw) as T) : null; },
    async putValue(key, value) { values.set(key, JSON.stringify(value)); },
  };
}

const jared = { id: 'j', oid: 'j', name: 'Jared Sunday', email: 'jared.sunday@guardrail.tech' };
const sam = { id: 's', oid: 's', name: 'Sam Rep', email: 'sam.rep@guardrail.tech' };

test.beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
  delete process.env.AZURE_AD_ALLOWED_EMAIL_DOMAIN;
  setStoreForTests(memoryStore());
});
test.afterAll(() => setStoreForTests(null));

test('the built-in admins are admins and everyone else is a rep until someone changes it', async () => {
  expect(await isAdmin(jared)).toBe(true);
  expect(await isAdmin(sam)).toBe(false);
  expect(await roleForEmail('Susan.Landaluce@guardrail.tech')).toBe('admin');
});

test('an admin can make a rep an admin, and back', async () => {
  await recordSignIn(sam);
  await setRole(jared, 'Sam.Rep@guardrail.tech', 'admin');
  expect(await isAdmin(sam)).toBe(true);
  const row = (await listPeople()).find((p) => p.email === 'sam.rep@guardrail.tech');
  expect(row).toMatchObject({ role: 'admin', name: 'Sam Rep', roleChangedBy: 'Jared Sunday' });
  expect(row?.lastSignInAt).toBeTruthy();

  await setRole(jared, sam.email, 'rep');
  expect(await isAdmin(sam)).toBe(false);
});

test('a built-in admin can be made a rep', async () => {
  await setRole(jared, 'dena.lumbang@guardrail.tech', 'rep');
  expect(await roleForEmail('dena.lumbang@guardrail.tech')).toBe('rep');
});

test('someone can be added before they first sign in', async () => {
  await setRole(jared, 'new.person@guardrail.tech', 'rep', 'New Person');
  const row = (await listPeople()).find((p) => p.email === 'new.person@guardrail.tech');
  expect(row).toMatchObject({ name: 'New Person', role: 'rep' });
  expect(row?.lastSignInAt).toBeFalsy();
});

test('admins cannot remove their own access, and one admin always remains', async () => {
  await expect(setRole(jared, jared.email, 'rep')).rejects.toThrow(RoleError);
  await setRole(jared, 'susan.landaluce@guardrail.tech', 'rep');
  await setRole(jared, 'dena.lumbang@guardrail.tech', 'rep');
  // Jared is the last admin; another admin (Sam) can't demote him either
  await setRole(jared, sam.email, 'admin');
  await setRole(sam, sam.email, 'admin');
  await setRole(sam, jared.email, 'rep');
  await expect(setRole(sam, sam.email, 'rep')).rejects.toThrow("can't remove your own");
  expect((await listPeople()).filter((p) => p.role === 'admin').map((p) => p.email)).toEqual([sam.email]);
});

test('bad input is refused', async () => {
  await expect(setRole(jared, 'not an email', 'admin')).rejects.toThrow('valid email');
  await expect(setRole(jared, sam.email, 'owner' as never)).rejects.toThrow('Admin or Rep');
  process.env.AZURE_AD_ALLOWED_EMAIL_DOMAIN = 'guardrail.tech';
  await expect(setRole(jared, 'someone@gmail.com', 'rep')).rejects.toThrow('@guardrail.tech');
});

test('opening the app records when someone was last active, at most every few minutes', async () => {
  // already signed in before sign-ins were recorded: the first page they open counts
  await recordSeen(sam);
  const first = (await listPeople()).find((p) => p.email === sam.email);
  expect(first).toMatchObject({ name: 'Sam Rep', role: 'rep' });
  expect(first?.lastSeenAt).toBeTruthy();
  await recordSeen(sam);
  expect((await listPeople()).find((p) => p.email === sam.email)?.lastSeenAt).toBe(first?.lastSeenAt);
});

test('recording activity never touches roles', async () => {
  await setRole(jared, sam.email, 'admin');
  await recordSignIn(sam);
  await recordSeen({ ...sam, email: 'other@guardrail.tech' });
  expect(await isAdmin(sam)).toBe(true);
  expect(await store().getValue('roles')).toEqual({ [sam.email]: expect.objectContaining({ role: 'admin' }) });
});

test('roles and sign-ins saved by the first version are still read', async () => {
  await store().putValue('people', { 'sam.rep@guardrail.tech': { email: 'sam.rep@guardrail.tech', name: 'Sam Rep', role: 'admin', lastSignInAt: '2026-11-09T10:00:00.000Z' } });
  expect(await isAdmin(sam)).toBe(true);
  expect((await listPeople()).find((p) => p.email === sam.email)?.lastSignInAt).toBe('2026-11-09T10:00:00.000Z');
});

test('locking a request or acting on one counts as being active', async () => {
  const quote = await upsertQuote({ ownerId: 'jay', ownerEmail: 'Jay.Rep@guardrail.tech', ownerName: 'Jay Rep',
    snapshot: { requestId: 'GRT-1', version: 1, customerName: 'Acme', lockedAt: '2026-11-09T09:15:00.000Z', status: 'STANDARD', customer: {} } });
  // never opened a page since visits were recorded, but the lock counts
  const jay = (await listPeople()).find((p) => p.email === 'jay.rep@guardrail.tech');
  expect(jay).toMatchObject({ name: 'Jay Rep' });
  expect(jay?.lastSeenAt && jay.lastSeenAt >= '2026-11-09T09:15:00.000Z').toBe(true);

  await new Promise((r) => setTimeout(r, 5));
  await recordActivity('note', quote, { name: 'Jay Rep', email: 'jay.rep@guardrail.tech' });
  const after = (await listPeople()).find((p) => p.email === 'jay.rep@guardrail.tech');
  expect(after?.lastSeenAt && after.lastSeenAt > (jay?.lastSeenAt as string)).toBe(true);
});

test('removing someone takes them off the list and away from admin, until they use the app again', async () => {
  await recordSignIn(sam);
  await setRole(jared, sam.email, 'admin');
  const people = await removePerson(jared, sam.email);
  expect(people.map((p) => p.email)).not.toContain(sam.email);
  expect(await isAdmin(sam)).toBe(false);

  await new Promise((r) => setTimeout(r, 5));
  await recordSeen(sam); // they open the app again
  expect((await listPeople()).find((p) => p.email === sam.email)).toMatchObject({ role: 'rep' });
});

test('a built-in admin who is removed stays a rep', async () => {
  await removePerson(jared, 'dena.lumbang@guardrail.tech');
  expect((await listPeople()).map((p) => p.email)).not.toContain('dena.lumbang@guardrail.tech');
  expect(await roleForEmail('dena.lumbang@guardrail.tech')).toBe('rep');
});

test('admins cannot remove themselves or the last admin', async () => {
  await expect(removePerson(jared, jared.email)).rejects.toThrow("can't remove yourself");
  await removePerson(jared, 'susan.landaluce@guardrail.tech');
  await removePerson(jared, 'dena.lumbang@guardrail.tech');
  await setRole(jared, sam.email, 'admin');
  await removePerson(sam, jared.email); // Sam is now the only admin
  await expect(removePerson({ ...jared, email: 'other@guardrail.tech' }, sam.email)).rejects.toThrow('at least one admin');
  await expect(removePerson(sam, 'nobody@guardrail.tech')).rejects.toThrow('not on the list');
});

test('adding a removed person back brings them back', async () => {
  await setRole(jared, sam.email, 'rep', 'Sam Rep');
  await removePerson(jared, sam.email);
  await setRole(jared, sam.email, 'admin');
  expect((await listPeople()).find((p) => p.email === sam.email)).toMatchObject({ role: 'admin' });
});
