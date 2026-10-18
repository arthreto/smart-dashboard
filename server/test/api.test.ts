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
const { openMain } = await import('../src/bootstrap.js');
const { HabitBook, setHabitDone } = await import('../src/habits.js');
const { addDays } = await import('../src/dates.js');
const { household } = await import('../src/households.js');

const mainDb = openMain(tmp);
const app = await buildApp(mainDb, { logger: false });
const H = { 'x-requested-with': 'smart-dashboard' };

let admin = ''; // cookie de session de l'administrateur
let user2 = ''; // cookie du compte invité
let tok1 = ''; // jeton du premier écran (foyer de l'admin)
let tok2 = ''; // second écran du même foyer
let dev1 = 0;
let dev2 = 0;

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  return (Array.isArray(set) ? set[0] : String(set)).split(';')[0];
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function pairScreen(cookie: string, name?: string): Promise<{ token: string; id: number }> {
  let res = await app.inject({ method: 'POST', url: '/api/devices/pairing-code', headers: { cookie, ...H }, payload: name ? { name } : {} });
  assert.equal(res.statusCode, 200);
  const { code } = res.json();
  assert.match(code, /^\d{6}$/);
  res = await app.inject({ method: 'POST', url: '/api/v1/pair', payload: { code, name: 'Tab5', firmware: '0.2.0' } });
  assert.equal(res.statusCode, 200);
  const token = res.json().token as string;
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(token) });
  return { token, id: res.json().device.id as number };
}

before(async () => {
  await app.ready();
});
after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('création du compte administrateur et session', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/auth/status' });
  assert.deepEqual(res.json(), { setupRequired: true, authenticated: false, user: null });

  res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { login: 'moi@exemple.fr', password: 'court' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { login: 'x', password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { login: 'moi@exemple.fr', password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 200);
  admin = cookieOf(res);
  assert.match(admin, /^sd_session=/);

  res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: admin } });
  const st = res.json();
  assert.equal(st.authenticated, true);
  assert.equal(st.user.role, 'admin');
  assert.equal(st.user.login, 'moi@exemple.fr');
  assert.ok(st.user.household.id > 0);

  res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { login: 'autre@exemple.fr', password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 409);
});

test('protection CSRF et accès non authentifié', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/habits', headers: { cookie: admin }, payload: {} });
  assert.equal(res.statusCode, 403);
  res = await app.inject({ method: 'GET', url: '/api/habits' });
  assert.equal(res.statusCode, 401);
  res = await app.inject({ method: 'GET', url: '/api/admin/users' });
  assert.equal(res.statusCode, 401);
});

test('connexion : identifiant inconnu, mauvais et bon mot de passe', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: 'personne', password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 401);
  res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: 'moi@exemple.fr', password: 'faux-mot-de-passe' } });
  assert.equal(res.statusCode, 401);
  res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: 'MOI@exemple.fr', password: 'un-mot-de-passe-solide' } });
  assert.equal(res.statusCode, 200);
});

test('habitudes par défaut, création et validation', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/habits', headers: { cookie: admin } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().length, 8);

  res = await app.inject({
    method: 'POST',
    url: '/api/habits',
    headers: { cookie: admin, ...H },
    payload: { name: 'Vélo', icon: 'run', color: '#30D158', days: [true, false, false, false, false, true, false], goal: '1 h' },
  });
  assert.equal(res.statusCode, 200);
  const created = res.json();
  res = await app.inject({ method: 'PATCH', url: `/api/habits/${created.id}`, headers: { cookie: admin, ...H }, payload: { color: 'rouge' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /Couleur/);
});

test('premier écran : appairage, réveils repris, état complet', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/v1/pair', payload: { code: '000000' } });
  assert.equal(res.statusCode, 401);

  ({ token: tok1, id: dev1 } = await pairScreen(admin));
  res = await app.inject({ method: 'GET', url: '/api/v1/state' });
  assert.equal(res.statusCode, 401);

  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) });
  assert.equal(res.statusCode, 200);
  const state = res.json();
  assert.equal(state.device.name, 'Écran 1');
  assert.equal(state.layout.length, 6);
  assert.equal(state.alarms.length, 4, 'les réveils d’exemple du foyer reviennent au premier écran');
  assert.equal(state.weather, null);
  assert.equal(state.tasks.items.length > 0, true);

  const first = state.tasks.items[0];
  res = await app.inject({ method: 'POST', url: `/api/v1/habits/${first.id}/toggle`, headers: bearer(tok1), payload: { done: true } });
  assert.equal(res.json().items.find((i: { id: number }) => i.id === first.id).done, true);

  res = await app.inject({ method: 'POST', url: '/api/v1/heartbeat', headers: bearer(tok1), payload: { battery: 78, charging: false, firmware: '0.2.0', rssi: -54 } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/overview', headers: { cookie: admin } });
  const ov = res.json();
  assert.equal(ov.devices.length, 1);
  assert.equal(ov.devices[0].online, true);
  assert.equal(ov.devices[0].battery, 78);
  assert.ok(ov.services.some((s: { id: string }) => s.id === 'spotify'));
});

test('second écran du même foyer : tâches partagées, réveils et réglages séparés', async () => {
  ({ token: tok2, id: dev2 } = await pairScreen(admin, 'Cuisine'));
  assert.notEqual(dev1, dev2);
  let res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok2) });
  const s2 = res.json();
  assert.equal(s2.device.name, 'Cuisine');
  assert.equal(s2.alarms.length, 0);
  // La tâche cochée depuis le premier écran l'est aussi ici.
  assert.ok(s2.tasks.items.some((i: { done: boolean }) => i.done));

  res = await app.inject({ method: 'POST', url: `/api/devices/${dev2}/alarms`, headers: { cookie: admin, ...H }, payload: { time: '25:00', days: [true, true, true, true, true, true, true] } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: `/api/devices/${dev2}/alarms`, headers: { cookie: admin, ...H }, payload: { time: '05:30', label: 'Tôt', days: [true, false, false, false, false, false, false], sound: 'douce' } });
  assert.equal(res.statusCode, 200);
  const alarm = res.json();
  assert.equal(alarm.deviceId, dev2);

  res = await app.inject({ method: 'PUT', url: `/api/devices/${dev2}/settings`, headers: { cookie: admin, ...H }, payload: { brightness: 35, nightMode: { start: '23:00' } } });
  assert.equal(res.json().brightness, 35);
  assert.equal(res.json().nightMode.end, '07:00');

  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) });
  const s1 = res.json();
  assert.equal(s1.alarms.length, 4);
  assert.notEqual(s1.settings.brightness, 35);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok2) });
  assert.equal(res.json().alarms.length, 1);
  assert.equal(res.json().settings.brightness, 35);

  // Un écran ne peut pas modifier le réveil d'un autre écran.
  res = await app.inject({ method: 'PATCH', url: `/api/v1/alarms/${alarm.id}`, headers: bearer(tok1), payload: { enabled: false } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'PATCH', url: `/api/v1/alarms/${alarm.id}`, headers: bearer(tok2), payload: { enabled: false } });
  assert.equal(res.json().enabled, false);

  res = await app.inject({ method: 'PUT', url: `/api/devices/${dev2}/layout`, headers: { cookie: admin, ...H }, payload: { widgets: [{ id: 'clock', span: 2 }, { id: 'clock', span: 1 }] } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'PUT', url: `/api/devices/${dev2}/layout`, headers: { cookie: admin, ...H }, payload: { widgets: [{ id: 'clock', span: 2 }, { id: 'cinema', span: 2 }, { id: 'tasks', span: 2 }, { id: 'music', span: 2 }] } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok2) });
  assert.equal(res.json().layout.length, 4);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) });
  assert.equal(res.json().layout.length, 6);

  res = await app.inject({ method: 'PATCH', url: `/api/devices/${dev2}`, headers: { cookie: admin, ...H }, payload: { name: 'Cuisine (frigo)' } });
  assert.equal(res.json().name, 'Cuisine (frigo)');
});

test('code PIN commun et commandes par écran', async () => {
  let res = await app.inject({ method: 'PUT', url: '/api/pin', headers: { cookie: admin, ...H }, payload: { pin: '12a4' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'PUT', url: '/api/pin', headers: { cookie: admin, ...H }, payload: { pin: '2580' } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok2) });
  assert.equal(res.json().settings.pinHash.length, 64);

  res = await app.inject({ method: 'POST', url: `/api/devices/${dev1}/commands`, headers: { cookie: admin, ...H }, payload: { type: 'message', text: 'À table !' } });
  const { id } = res.json();
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) });
  assert.ok(res.json().commands.some((c: { id: number; text: string }) => c.id === id && c.text === 'À table !'));
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok2) });
  assert.ok(!res.json().commands.some((c: { id: number }) => c.id === id), 'le message ne va qu’à l’écran choisi');
  await app.inject({ method: 'POST', url: '/api/v1/heartbeat', headers: bearer(tok1), payload: { ackCommands: [id] } });
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) });
  assert.ok(!res.json().commands.some((c: { id: number }) => c.id === id));

  // Message à tous les écrans du foyer.
  res = await app.inject({ method: 'POST', url: '/api/devices/broadcast', headers: { cookie: admin, ...H }, payload: { text: '' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/api/devices/broadcast', headers: { cookie: admin, ...H }, payload: { text: 'Bonne nuit' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().screens, 2);
  for (const tok of [tok1, tok2]) {
    res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok) });
    assert.ok(res.json().commands.some((c: { type: string; text: string }) => c.type === 'message' && c.text === 'Bonne nuit'));
  }
});

test('capture d’écran RGB565 par écran', async () => {
  const w = 32;
  const h = 18;
  let res = await app.inject({
    method: 'POST',
    url: '/api/v1/screenshot',
    headers: { ...bearer(tok1), 'content-type': 'application/octet-stream', 'x-width': String(w), 'x-height': String(h) },
    payload: Buffer.alloc(w * h * 2, 0xf8),
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: `/api/devices/${dev1}/screenshot.jpg`, headers: { cookie: admin } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  res = await app.inject({ method: 'GET', url: `/api/devices/${dev2}/screenshot.jpg`, headers: { cookie: admin } });
  assert.equal(res.statusCode, 404);
});

test('invitation : nouveau compte avec son propre foyer, isolé des autres', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/admin/invites', headers: { cookie: admin, ...H }, payload: { note: 'Léa', days: 3 } });
  assert.equal(res.statusCode, 200);
  const { url } = res.json();
  const token = url.split('/invitation/')[1];
  assert.ok(token.length > 20);

  res = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
  assert.equal(res.json().valid, true);
  assert.equal(res.json().kind, 'invite');

  res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: H, payload: { login: 'moi@exemple.fr', password: 'mot-de-passe-de-lea' } });
  assert.equal(res.statusCode, 400, 'identifiant déjà pris');
  res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: H, payload: { login: 'lea@exemple.fr', name: 'Léa', password: 'mot-de-passe-de-lea', householdName: 'Appart de Léa' } });
  assert.equal(res.statusCode, 200);
  user2 = cookieOf(res);

  res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: H, payload: { login: 'bis@exemple.fr', password: 'encore-un-mot-de-passe' } });
  assert.equal(res.statusCode, 410, 'lien à usage unique');

  res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: user2 } });
  const st = res.json();
  assert.equal(st.user.role, 'user');
  assert.equal(st.user.household.name, 'Appart de Léa');

  // Ses propres données d'exemple, sans l'habitude « Vélo » ni les écrans de l'admin.
  res = await app.inject({ method: 'GET', url: '/api/habits', headers: { cookie: user2 } });
  assert.equal(res.json().length, 8);
  assert.ok(!res.json().some((h: { name: string }) => h.name === 'Vélo'));
  res = await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie: user2 } });
  assert.deepEqual(res.json(), []);
  res = await app.inject({ method: 'GET', url: `/api/devices/${dev1}`, headers: { cookie: user2 } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'PUT', url: `/api/devices/${dev1}/settings`, headers: { cookie: user2, ...H }, payload: { brightness: 5 } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'POST', url: `/api/devices/${dev1}/commands`, headers: { cookie: user2, ...H }, payload: { type: 'reboot' } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'POST', url: '/api/devices/pairing-code', headers: { cookie: user2, ...H }, payload: { deviceId: dev1 } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: user2 } });
  assert.equal(res.statusCode, 403);

  // Son écran voit ses données, pas celles de l'admin.
  const lea = await pairScreen(user2);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(lea.token) });
  assert.equal(res.json().alarms.length, 4);
  assert.ok(!res.json().tasks.items.some((i: { done: boolean }) => i.done));
  assert.ok(!(await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) })).json().tasks.items.every((i: { done: boolean }) => !i.done));

  res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: admin } });
  const users = res.json();
  assert.equal(users.length, 2);
  assert.equal(users.find((u: { login: string }) => u.login === 'lea@exemple.fr').devices, 1);
});

test('administration : désactivation, lien de réinitialisation, suppression', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: admin } });
  const lea = res.json().find((u: { login: string }) => u.login === 'lea@exemple.fr');
  const me = res.json().find((u: { login: string }) => u.login === 'moi@exemple.fr');

  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${me.id}`, headers: { cookie: admin, ...H }, payload: { disabled: true } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H }, payload: { disabled: true } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/habits', headers: { cookie: user2 } });
  assert.equal(res.statusCode, 401, 'sessions fermées');
  res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: 'lea@exemple.fr', password: 'mot-de-passe-de-lea' } });
  assert.equal(res.statusCode, 403);
  await app.inject({ method: 'PATCH', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H }, payload: { disabled: false } });

  res = await app.inject({ method: 'POST', url: `/api/admin/users/${lea.id}/reset-link`, headers: { cookie: admin, ...H } });
  const token = res.json().url.split('/invitation/')[1];
  res = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
  assert.equal(res.json().kind, 'reset');
  assert.equal(res.json().login, 'lea@exemple.fr');
  res = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: H, payload: { password: 'nouveau-mot-de-passe' } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: 'lea@exemple.fr', password: 'nouveau-mot-de-passe' } });
  assert.equal(res.statusCode, 200);

  const leaHousehold = lea.household.id;
  res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H } });
  assert.equal(res.statusCode, 200);
  assert.ok(!fs.existsSync(path.join(tmp, 'households', `${leaHousehold}.db`)), 'la base du foyer est supprimée');
  res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: admin } });
  assert.equal(res.json().length, 1);
});

test('services : app Spotify du serveur, secrets masqués, compte par foyer', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie: admin } });
  const sp0 = res.json().find((i: { id: string }) => i.id === 'spotify');
  assert.match(sp0.statusDetail, /administrateur/);
  assert.equal(sp0.actions.length, 0);

  res = await app.inject({
    method: 'PUT',
    url: '/api/admin/services/spotify',
    headers: { cookie: admin, ...H },
    payload: { config: { clientId: 'abc123def456' }, secrets: { clientSecret: 'super-secret-value-f5d3' } },
  });
  assert.equal(res.statusCode, 200);
  const svc = res.json();
  assert.equal(svc.configured, true);
  assert.equal(svc.secrets.clientSecret.preview, '••••f5d3');
  assert.ok(!JSON.stringify(svc).includes('super-secret-value'));
  assert.match(svc.config.redirectUri, /\/api\/oauth\/spotify\/callback$/);
  const raw = mainDb.prepare("SELECT value FROM global_settings WHERE key = 'app:spotify'").get() as { value: string };
  assert.ok(!raw.value.includes('super-secret'));

  res = await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie: admin } });
  const sp = res.json().find((i: { id: string }) => i.id === 'spotify');
  assert.equal(sp.actions[0].id, 'connect');
  assert.equal(sp.config.appStatus, 'Configurée par l’administrateur');
  assert.ok(!JSON.stringify(sp).includes('super-secret'));

  res = await app.inject({ method: 'GET', url: '/api/integrations/spotify/connect', headers: { cookie: admin } });
  assert.equal(res.statusCode, 302);
  assert.match(String(res.headers.location), /client_id=abc123def456/);

  res = await app.inject({ method: 'PUT', url: '/api/integrations/weather', headers: { cookie: admin, ...H }, payload: { config: { latitude: 200 } } });
  assert.equal(res.statusCode, 400);

  // Service retiré par l'administrateur : il disparaît des foyers.
  res = await app.inject({ method: 'PUT', url: '/api/admin/services/roblox', headers: { cookie: admin, ...H }, payload: { available: false } });
  assert.equal(res.json().available, false);
  res = await app.inject({ method: 'GET', url: '/api/integrations', headers: { cookie: admin } });
  assert.ok(!res.json().some((i: { id: string }) => i.id === 'roblox'));
  res = await app.inject({ method: 'PUT', url: '/api/integrations/roblox', headers: { cookie: admin, ...H }, payload: { enabled: true } });
  assert.equal(res.statusCode, 400);
});

test('retrait d’un écran : son jeton et ses réveils disparaissent', async () => {
  let res = await app.inject({ method: 'DELETE', url: `/api/devices/${dev2}`, headers: { cookie: admin, ...H } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok2) });
  assert.equal(res.statusCode, 401);
  const db = household(1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM alarms WHERE device_id = ?').get(dev2) as { n: number }).n, 0);
});

test('reprise d’une installation de l’ancienne version', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-legacy-'));
  const { hashPassword, sha256, encryptJson } = await import('../src/crypto.js');
  const legacy = openDb(path.join(dir, 'smart-dashboard.db'));
  legacy.prepare("INSERT INTO admin (id, password_hash, created_at) VALUES (1, ?, '2026-10-01T10:00:00.000Z')").run(hashPassword('ancien-mot-de-passe'));
  legacy.prepare("UPDATE device SET token_hash = ?, name = 'Chambre', paired_at = '2026-10-02T10:00:00.000Z' WHERE id = 1").run(sha256('sdb_ancien'));
  legacy.prepare("INSERT INTO settings (key, value) VALUES ('display', '{\"brightness\":42}')").run();
  legacy.prepare("INSERT INTO alarms (time, label, days, created_at) VALUES ('06:30', 'Boulot', 31, '2026-10-01')").run();
  legacy.prepare('DELETE FROM alarms WHERE label != ?').run('Boulot');
  legacy
    .prepare("INSERT INTO integrations (id, enabled, config, secrets_enc) VALUES ('spotify', 1, ?, ?)")
    .run(JSON.stringify({ clientId: 'legacyclient1', account: 'Arthur' }), encryptJson({ clientSecret: 'legacy-secret', refreshToken: 'r1' }));
  // Retour au schéma exact de l'ancienne version (avant les écrans multiples).
  legacy.exec('DROP INDEX alarms_device; DROP INDEX commands_device; ALTER TABLE alarms DROP COLUMN device_id; ALTER TABLE commands DROP COLUMN device_id;');
  legacy.pragma('user_version = 1');
  legacy.close();

  const { migrateLegacy } = await import('../src/bootstrap.js');
  const { openMainDb } = await import('../src/db.js');
  const m = openMainDb(path.join(dir, 'main.db'));
  assert.equal(migrateLegacy(m, dir), true);
  assert.ok(!fs.existsSync(path.join(dir, 'smart-dashboard.db')));
  assert.ok(fs.existsSync(path.join(dir, 'households', '1.db')));

  const u = m.prepare("SELECT * FROM users WHERE login = 'admin'").get() as { role: string; household_id: number; password_hash: string };
  assert.equal(u.role, 'admin');
  assert.equal(u.household_id, 1);
  const { verifyPassword } = await import('../src/crypto.js');
  assert.ok(verifyPassword('ancien-mot-de-passe', u.password_hash));
  const d = m.prepare('SELECT * FROM devices WHERE id = 1').get() as { name: string; token_hash: string; display: string };
  assert.equal(d.name, 'Chambre');
  assert.equal(d.token_hash, sha256('sdb_ancien'));
  assert.equal(JSON.parse(d.display).brightness, 42);

  const hdb = openDb(path.join(dir, 'households', '1.db'));
  assert.equal((hdb.prepare("SELECT device_id FROM alarms WHERE label = 'Boulot'").get() as { device_id: number }).device_id, 1);
  const sp = hdb.prepare("SELECT config FROM integrations WHERE id = 'spotify'").get() as { config: string };
  assert.equal(JSON.parse(sp.config).clientId, undefined);
  assert.equal(JSON.parse(sp.config).account, 'Arthur');
  hdb.close();
  const g = JSON.parse((m.prepare("SELECT value FROM global_settings WHERE key = 'app:spotify'").get() as { value: string }).value);
  assert.equal(g.config.clientId, 'legacyclient1');
  assert.equal(migrateLegacy(m, dir), false, 'une seule fois');
  m.close();
  fs.rmSync(dir, { recursive: true, force: true });
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
  assert.ok(book.bestStreak() >= 9);
  setHabitDone(d2, 1, today, true);
  book = new HabitBook(d2);
  assert.equal(book.streak(), 10);
  assert.equal(book.habitStreak(book.habits[0]), 3);
  d2.close();
});
