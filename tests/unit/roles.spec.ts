import { expect, test } from '@playwright/test';
import { isAdmin, listPeople, recordSignIn, roleForEmail, RoleError, setRole } from '../../src/lib/admin';
import { setStoreForTests, type Store } from '../../src/lib/store';

// Roles against an in-memory store.

function memoryStore(): Store {
  const quotes = new Map<string, { id: string }>(), values = new Map<string, string>();
  return {
    async all<T>() { return [...quotes.values()] as T[]; },
    async get<T>(id: string) { return (quotes.get(id) as T) || null; },
    async put(record) { quotes.set(record.id, record); },
    async remove(id) { return quotes.delete(id); },
    async putPdf() {},
    async getPdf() { return null; },
    async removePdf() {},
    async addEvent() {},
    async events<T>() { return [] as T[]; },
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
