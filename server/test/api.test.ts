import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
process.env.DATA_DIR = tmp;
process.env.WEB_DIR = path.join(tmp, 'no-web');

const { openDb } = await import('../src/db.js');
const { buildApp } = await import('../src/app.js');
const { HabitBook, setHabitDone } = await import('../src/habits.js');
const { addDays } = await import('../src/dates.js');

const db = openDb(path.join(tmp, 'test.db'));
const app = await buildApp(db, { logger: false });
let cookie = '';
let deviceToken = '';
const H = { 'x-requested-with': 'smart-dashboard' };

before(async () => {
  await app.ready();
});
after(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('création du compte et session', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/auth/status' });
  assert.deepEqual(res.json(), { setupRequired: true, authenticated: false, totpEnabled: false });

  res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { password: 'court' } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 200);
  const set = res.headers['set-cookie'];
  cookie = (Array.isArray(set) ? set[0] : String(set)).split(';')[0];
  assert.match(cookie, /^sd_session=/);

  res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } });
  assert.equal(res.json().authenticated, true);
});

test('protection CSRF et accès non authentifié', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/habits', headers: { cookie }, payload: {} });
  assert.equal(res.statusCode, 403);
  res = await app.inject({ method: 'GET', url: '/api/habits' });
  assert.equal(res.statusCode, 401);
});

test('connexion avec mauvais et bon mot de passe', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { password: 'faux-mot-de-passe' } });
  assert.equal(res.statusCode, 401);
  res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 200);
});

test('habitudes par défaut, création et validation', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/habits', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().length, 8);

  res = await app.inject({
    method: 'POST',
    url: '/api/habits',
    headers: { cookie, ...H },
    payload: { name: 'Vélo', icon: 'run', color: '#30D158', days: [true, false, false, false, false, true, false], goal: '1 h' },
  });
  assert.equal(res.statusCode, 200);
  const created = res.json();
  assert.equal(created.name, 'Vélo');

  res = await app.inject({ method: 'PATCH', url: `/api/habits/${created.id}`, headers: { cookie, ...H }, payload: { color: 'rouge' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /Couleur/);

  res = await app.inject({ method: 'PATCH', url: `/api/habits/${created.id}`, headers: { cookie, ...H }, payload: { archived: true } });
  assert.equal(res.json().archived, true);
});

test('appairage de la tablette et état complet', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/device/pairing-code', headers: { cookie, ...H } });
  const { code } = res.json();
  assert.match(code, /^\d{6}$/);

  res = await app.inject({ method: 'POST', url: '/api/v1/pair', payload: { code: '000000' === code ? '111111' : '000000' } });
  assert.equal(res.statusCode, 401);

  res = await app.inject({ method: 'POST', url: '/api/v1/pair', payload: { code, name: 'Tab5 test', firmware: '0.1.0' } });
  assert.equal(res.statusCode, 200);
  deviceToken = res.json().token;

  res = await app.inject({ method: 'GET', url: '/api/v1/state' });
  assert.equal(res.statusCode, 401);

  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { authorization: `Bearer ${deviceToken}` } });
  assert.equal(res.statusCode, 200);
  const state = res.json();
  assert.ok(state.serverTime > 0);
  assert.equal(state.layout.length, 6);
  assert.ok(Array.isArray(state.tasks.items));
  assert.equal(state.alarms.length, 4);
  assert.equal(state.weather, null);

  const first = state.tasks.items[0];
  res = await app.inject({ method: 'POST', url: `/api/v1/habits/${first.id}/toggle`, headers: { authorization: `Bearer ${deviceToken}` }, payload: { done: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().items.find((i: { id: number }) => i.id === first.id).done, true);

  res = await app.inject({ method: 'POST', url: '/api/v1/heartbeat', headers: { authorization: `Bearer ${deviceToken}` }, payload: { battery: 78, charging: false, firmware: '0.1.0', rssi: -54 } });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: 'GET', url: '/api/overview', headers: { cookie } });
  const ov = res.json();
  assert.equal(ov.device.online, true);
  assert.equal(ov.device.battery, 78);
  assert.ok(ov.services.some((s: { id: string }) => s.id === 'spotify'));
});

test('commandes à distance livrées puis acquittées', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/device/commands', headers: { cookie, ...H }, payload: { type: 'message', text: 'À table !' } });
  const { id } = res.json();
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { authorization: `Bearer ${deviceToken}` } });
  assert.ok(res.json().commands.some((c: { id: number; text: string }) => c.id === id && c.text === 'À table !'));
  await app.inject({ method: 'POST', url: '/api/v1/heartbeat', headers: { authorization: `Bearer ${deviceToken}` }, payload: { ackCommands: [id] } });
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { authorization: `Bearer ${deviceToken}` } });
  assert.ok(!res.json().commands.some((c: { id: number }) => c.id === id));
});

test('réveils, disposition, PIN et réglages', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/alarms', headers: { cookie, ...H }, payload: { time: '25:00', label: 'x', days: [true, true, true, true, true, true, true] } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/api/alarms', headers: { cookie, ...H }, payload: { time: '05:30', label: 'Tôt', days: [true, false, false, false, false, false, false], sound: 'douce' } });
  assert.equal(res.json().time, '05:30');

  res = await app.inject({ method: 'PUT', url: '/api/device/layout', headers: { cookie, ...H }, payload: { widgets: [{ id: 'clock', span: 2 }, { id: 'clock', span: 1 }] } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'PUT', url: '/api/device/layout', headers: { cookie, ...H }, payload: { widgets: [{ id: 'clock', span: 2 }, { id: 'cinema', span: 2 }, { id: 'tasks', span: 2 }, { id: 'music', span: 2 }] } });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: 'PUT', url: '/api/device/pin', headers: { cookie, ...H }, payload: { pin: '12a4' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'PUT', url: '/api/device/pin', headers: { cookie, ...H }, payload: { pin: '2580' } });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: 'PUT', url: '/api/device/settings', headers: { cookie, ...H }, payload: { brightness: 70, nightMode: { start: '23:00' } } });
  assert.equal(res.json().brightness, 70);
  assert.equal(res.json().nightMode.start, '23:00');
  assert.equal(res.json().nightMode.end, '07:00');

  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { authorization: `Bearer ${deviceToken}` } });
  const st = res.json();
  assert.equal(st.settings.pinHash.length, 64);
  assert.equal(st.layout.length, 4);
});

test('intégrations : validation et secrets masqués', async () => {
  let res = await app.inject({ method: 'PUT', url: '/api/integrations/weather', headers: { cookie, ...H }, payload: { config: { latitude: 200 } } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({
    method: 'PUT',
    url: '/api/integrations/spotify',
    headers: { cookie, ...H },
    payload: { config: { clientId: 'abc123' }, secrets: { clientSecret: 'super-secret-value-f5d3' } },
  });
  assert.equal(res.statusCode, 200);
  const sp = res.json();
  assert.equal(sp.secrets.clientSecret.set, true);
  assert.equal(sp.secrets.clientSecret.preview, '••••f5d3');
  assert.ok(!JSON.stringify(sp).includes('super-secret-value'));
  assert.match(sp.config.redirectUri, /\/api\/oauth\/spotify\/callback$/);

  res = await app.inject({ method: 'GET', url: '/api/integrations/spotify/secret/clientSecret', headers: { cookie } });
  assert.equal(res.json().value, 'super-secret-value-f5d3');

  const raw = db.prepare("SELECT secrets_enc FROM integrations WHERE id = 'spotify'").get() as { secrets_enc: string };
  assert.ok(!raw.secrets_enc.includes('super-secret'));
});

test('capture d’écran RGB565', async () => {
  const w = 32;
  const h = 18;
  const buf = Buffer.alloc(w * h * 2, 0xf8);
  let res = await app.inject({
    method: 'POST',
    url: '/api/v1/screenshot',
    headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/octet-stream', 'x-width': String(w), 'x-height': String(h) },
    payload: buf,
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/device/screenshot.jpg', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
});

test('séries avec jokers', async () => {
  // Base isolée : 1 habitude quotidienne créée il y a 20 jours.
  const d2 = openDb(':memory:');
  const created = new Date(Date.now() - 20 * 86400_000).toISOString();
  d2.prepare("INSERT INTO habits (name, icon, color, days, created_at) VALUES ('Test', 'check', '#30D158', 127, ?)").run(created);
  const book0 = new HabitBook(d2);
  const today = book0.today;
  // Fait chaque jour sauf il y a 3 jours (joker) → la série continue.
  for (let i = 1; i <= 10; i++) if (i !== 3) setHabitDone(d2, 1, addDays(today, -i), true);
  let book = new HabitBook(d2);
  assert.equal(book.streak(), 9);
  // Un deuxième raté la même semaine ISO casserait la série : on vérifie juste le meilleur score.
  assert.ok(book.bestStreak() >= 9);
  setHabitDone(d2, 1, today, true);
  book = new HabitBook(d2);
  assert.equal(book.streak(), 10);
  assert.equal(book.habitStreak(book.habits[0]), 3);
  d2.close();
});
