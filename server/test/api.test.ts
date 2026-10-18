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
let tokLea = ''; // écran du foyer de Léa

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
  tokLea = lea.token;
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
  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${me.id}`, headers: { cookie: admin, ...H }, payload: { disabled: 1 } });
  assert.equal(res.statusCode, 400, 'valeur non booléenne refusée');
  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${me.id}`, headers: { cookie: admin, ...H }, payload: { role: 'superadmin', disabled: false } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'GET', url: '/api/habits', headers: { cookie: admin } });
  assert.equal(res.statusCode, 200, 'l’administrateur est toujours connecté');

  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H }, payload: { disabled: true } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/habits', headers: { cookie: user2 } });
  assert.equal(res.statusCode, 401, 'sessions fermées');
  res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: 'lea@exemple.fr', password: 'mot-de-passe-de-lea' } });
  assert.equal(res.statusCode, 403);
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tokLea) });
  assert.equal(res.statusCode, 403, 'les écrans d’un compte désactivé s’arrêtent');
  await app.inject({ method: 'PATCH', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H }, payload: { disabled: false } });
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tokLea) });
  assert.equal(res.statusCode, 200);

  // Un administrateur promu peut être rétrogradé, mais jamais le dernier administrateur actif.
  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H }, payload: { role: 'admin' } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'PATCH', url: `/api/admin/users/${lea.id}`, headers: { cookie: admin, ...H }, payload: { role: 'user' } });
  assert.equal(res.statusCode, 200);

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
  assert.equal(hdb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'admin'").get(), undefined, 'ancien mot de passe retiré de la base du foyer');
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

test('appairage : plafond global de codes refusés (adresses multiples)', async () => {
  const { resetPairingGuard } = await import('../src/routes/device.js');
  resetPairingGuard();
  for (let i = 0; i < 30; i++) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/pair', remoteAddress: `203.0.113.${i + 1}`, payload: { code: String(100000 + i) } });
    assert.equal(res.statusCode, 401);
  }
  let res = await app.inject({ method: 'POST', url: '/api/devices/pairing-code', headers: { cookie: admin, ...H }, payload: {} });
  const { code } = res.json();
  res = await app.inject({ method: 'POST', url: '/api/v1/pair', remoteAddress: '198.51.100.7', payload: { code } });
  assert.equal(res.statusCode, 429, 'même un bon code est refusé pendant la suspension');
  resetPairingGuard();
});

test('journaux et limites : jetons masqués, préfixe IPv6 /64', async () => {
  const { safeUrl, rateLimitKey } = await import('../src/app.js');
  assert.equal(safeUrl('/api/invites/abcDEF123/accept'), '/api/invites/…/accept');
  assert.equal(safeUrl('/api/oauth/spotify/callback?code=x&state=y'), '/api/oauth/spotify/callback?…');
  assert.equal(safeUrl('/api/habits'), '/api/habits');
  assert.equal(rateLimitKey('203.0.113.9'), '203.0.113.9');
  assert.equal(rateLimitKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(rateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(rateLimitKey('2001:db8:1:2::5'), '2001:db8:1:2::/64');
  assert.equal(rateLimitKey('2001:db8::1'), '2001:db8:0:0::/64');
});

test('écran : textes simplifiés (emojis) et réponse « rien n’a changé »', async () => {
  const { deviceText } = await import('../src/deviceText.js');
  assert.equal(deviceText('🎂 Anniversaire de Léa'), '🎂 Anniversaire de Léa');
  assert.equal(deviceText('❤️ Soirée'), '❤ Soirée');
  assert.equal(deviceText('👨‍👩‍👧 Famille'), '👨 Famille');
  assert.equal(deviceText('👍🏽 OK'), '👍 OK');
  assert.equal(deviceText('🇫🇷 Match'), 'Match');
  assert.equal(deviceText('🦖 Dino'), 'Dino');
  assert.equal(deviceText('Ștefan'), 'Stefan');

  let res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) });
  const hash = res.json().stateHash as string;
  assert.match(hash, /^[0-9a-f]{16}$/);
  res = await app.inject({ method: 'GET', url: `/api/v1/state?known=${hash}`, headers: bearer(tok1) });
  assert.equal(res.json().unchanged, true);
  assert.ok(res.json().serverTime > 0);
  // Une tâche cochée : l'état change, l'écran reçoit tout.
  const items = (await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(tok1) })).json().tasks.items;
  await app.inject({ method: 'POST', url: `/api/v1/habits/${items[0].id}/toggle`, headers: bearer(tok1), payload: {} });
  res = await app.inject({ method: 'GET', url: `/api/v1/state?known=${hash}`, headers: bearer(tok1) });
  assert.equal(res.json().unchanged, undefined);
  assert.notEqual(res.json().stateHash, hash);
  await app.inject({ method: 'POST', url: `/api/v1/habits/${items[0].id}/toggle`, headers: bearer(tok1), payload: {} });
});

test('agenda iCloud : répétitions à la bonne heure, journées entières sur plusieurs jours, 7 jours glissants', async () => {
  const { eventsFromIcs, agendaForDevice, floatingToDate } = await import('../src/integrations/icloud.js');
  const { setCache } = await import('../src/db.js');
  const { dateKey, addDays } = await import('../src/dates.js');
  const tz = 'BEGIN:VTIMEZONE\nTZID:Europe/Paris\nBEGIN:DAYLIGHT\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0200\nDTSTART:19810329T020000\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\nEND:DAYLIGHT\nBEGIN:STANDARD\nTZOFFSETFROM:+0200\nTZOFFSETTO:+0100\nDTSTART:19961027T030000\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\nEND:STANDARD\nEND:VTIMEZONE';
  const cal = (body: string) => `BEGIN:VCALENDAR\nVERSION:2.0\n${tz}\nBEGIN:VEVENT\n${body}\nEND:VEVENT\nEND:VCALENDAR`;
  const cals = { name: 'Perso', color: '#FF9F0A' };

  // Hebdomadaire à 9 h, de part et d'autre du passage à l'heure d'hiver (25 octobre 2026).
  const out: import('../src/integrations/icloud.js').AgendaEvent[] = [];
  eventsFromIcs(out, cal('UID:w\nDTSTART;TZID=Europe/Paris:20261019T090000\nDTEND;TZID=Europe/Paris:20261019T100000\nRRULE:FREQ=WEEKLY\nSUMMARY:Hebdo'), new Date('2026-10-18T00:00:00'), new Date('2026-11-10T00:00:00'), cals);
  assert.deepEqual(out.map((e) => `${e.date} ${e.start}`), ['2026-10-19 09:00', '2026-10-26 09:00', '2026-11-02 09:00', '2026-11-09 09:00']);
  assert.equal(floatingToDate(new Date('2026-07-01T09:00:00Z'), 'Europe/Paris').toISOString(), '2026-07-01T07:00:00.000Z');

  // Semaine glissante et journée entière sur 3 jours.
  const today = dateKey();
  const d = (n: number) => addDays(today, n).replace(/-/g, '');
  const ev2: import('../src/integrations/icloud.js').AgendaEvent[] = [];
  const from = new Date(`${addDays(today, -1)}T00:00:00`);
  const to = new Date(`${addDays(today, 30)}T00:00:00`);
  eventsFromIcs(ev2, cal(`UID:a\nDTSTART;VALUE=DATE:${d(1)}\nDTEND;VALUE=DATE:${d(4)}\nSUMMARY:Vacances`), from, to, cals);
  eventsFromIcs(ev2, cal(`UID:n\nDTSTART;TZID=Europe/Paris:${d(0)}T230000\nDTEND;TZID=Europe/Paris:${d(1)}T010000\nSUMMARY:Nuit`), from, to, cals);
  const hdb = openDb(':memory:');
  setCache(hdb, 'icloud', { events: ev2, calendars: [], updatedAt: new Date().toISOString() });
  const ag = agendaForDevice(hdb)!;
  assert.equal(ag.week[0].date, today, 'la grille commence aujourd’hui');
  assert.equal(ag.week.length, 7);
  const titles = (i: number) => ag.week[i].events.map((e) => `${e.title}${e.allDay ? '' : ` ${e.start}-${e.end}`}`);
  assert.deepEqual(titles(0), ['Nuit 23:00-24:00']);
  assert.deepEqual(titles(1), ['Vacances', 'Nuit 00:00-01:00']);
  assert.deepEqual(titles(3), ['Vacances']);
  assert.deepEqual(titles(4), []);
  assert.equal(ag.today[0].date, today);
});

test('agenda : période demandée par l’écran (navigation)', async () => {
  const { agendaRange } = await import('../src/integrations/icloud.js');
  const { setCache } = await import('../src/db.js');
  const hdb = openDb(':memory:');
  const ev = { id: 'x', date: '2027-01-05', start: '10:00', end: '11:00', startTs: new Date('2027-01-05T10:00:00').getTime(), endTs: new Date('2027-01-05T11:00:00').getTime(), endDate: '2027-01-05', title: 'Rendez-vous', location: 'Cabinet', calendar: 'Perso', color: '#FF9F0A', allDay: false, important: false, reminderMinutes: null };
  setCache(hdb, 'icloud', { events: [ev], calendars: [], updatedAt: '', rangeFrom: '2026-12-01', rangeTo: '2027-03-01' });
  const ctx = { db: hdb, householdId: 0, config: {}, secrets: {}, app: {} } as never;
  const r = await agendaRange(ctx, '2027-01-04', '2027-01-07');
  assert.deepEqual(r.days.map((d) => d.date), ['2027-01-04', '2027-01-05', '2027-01-06']);
  assert.equal(r.days[1].events[0].title, 'Rendez-vous');
  assert.equal(r.days[1].events[0].location, 'Cabinet');
  await assert.rejects(agendaRange(ctx, '2027-01-01', '2027-06-01'), /trop longue/);
});

test('cinéma : fiche du film et lien de bande-annonce', async () => {
  const { filmDetails } = await import('../src/integrations/pathe.js');
  const { setCache } = await import('../src/db.js');
  const hdb = openDb(':memory:');
  const info = { synopsis: 'Un résumé.', directors: 'Une Réalisatrice', actors: 'A, B', trailerUrl: '', pageUrl: 'https://www.pathe.fr/films/film-a', releaseDate: '2026-10-01', posterLargeUrl: '' };
  setCache(hdb, 'pathe', { cinemaId: 'c', cinemaName: 'Pathé', days: [], films: [{ id: 'film-a', title: 'Film A', genre: 'Drame', duration: '2 h', rating: '', isNew: false, releaseDate: '', posterUrl: '', showsByDay: {}, info }], upcoming: [], updatedAt: '' });
  const d = filmDetails(hdb, 'film-a')!;
  assert.equal(d.synopsis, 'Un résumé.');
  assert.equal(d.trailerUrl, 'https://www.pathe.fr/films/film-a');
  assert.equal(d.trailerIsPage, true);
  assert.equal(filmDetails(hdb, 'inconnu'), null);
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
