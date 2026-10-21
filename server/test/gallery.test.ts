// Galerie chiffrée : de la demande d'enregistrement au déchiffrement des morceaux, avec les
// mêmes algorithmes que la tablette (RSA-OAEP SHA-256, AES-256-GCM) et le navigateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-gallery-'));
process.env.DATA_DIR = tmp;
process.env.WEB_DIR = path.join(tmp, 'no-web');

const { buildApp } = await import('../src/app.js');
const { openMain } = await import('../src/bootstrap.js');
const { main } = await import('../src/households.js');
const { waitingCount } = await import('../src/wake.js');

const mainDb = openMain(tmp);
const app = await buildApp(mainDb, { logger: false });
const H = { 'x-requested-with': 'smart-dashboard' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

let cookie = '';
let other = '';
let token = '';
let deviceId = 0;

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const spki = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
const kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: crypto.randomBytes(16).toString('base64'), iv: crypto.randomBytes(12).toString('base64') };
const privateKeyEnc = crypto.randomBytes(1300).toString('base64'); // (opaque pour le serveur)

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  return (Array.isArray(set) ? set[0] : String(set)).split(';')[0];
}

/** Ce que fait la tablette : clé de la vidéo + préfixe, chiffrés pour le compte. */
function deviceKeys() {
  const key = crypto.randomBytes(32);
  const prefix = crypto.randomBytes(8);
  const wrapped = crypto.publicEncrypt(
    { key: crypto.createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' }), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.concat([key, prefix]),
  );
  return { key, prefix, wrapped };
}

function seal(key: Buffer, prefix: Buffer, videoId: string, n: number, final: boolean, plain: Buffer): Buffer {
  const iv = Buffer.alloc(12);
  prefix.copy(iv, 0);
  iv.writeUInt32BE(n, 8);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(`sdv1:${videoId}:${n}:${final ? 1 : 0}`));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

before(async () => {
  await app.ready();
  let res = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: H, payload: { login: 'moi@exemple.fr', password: 'un-mot-de-passe-solide' } });
  cookie = cookieOf(res);
  res = await app.inject({ method: 'POST', url: '/api/devices/pairing-code', headers: { cookie, ...H }, payload: {} });
  res = await app.inject({ method: 'POST', url: '/api/v1/pair', payload: { code: res.json().code, name: 'Tab5', firmware: '0.2.0' } });
  token = res.json().token;
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(token) });
  deviceId = res.json().device.id;
  // Un deuxième compte (autre foyer) pour vérifier l'isolement.
  res = await app.inject({ method: 'POST', url: '/api/admin/invites', headers: { cookie, ...H }, payload: {} });
  const inviteToken = String(res.json().url).split('/').pop();
  res = await app.inject({ method: 'POST', url: `/api/invites/${inviteToken}/accept`, headers: H, payload: { login: 'lea@exemple.fr', password: 'un-autre-mot-de-passe', name: 'Léa', householdName: 'Chez Léa' } });
  other = res.statusCode === 200 ? cookieOf(res) : '';
});
after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('la galerie doit être protégée avant tout enregistrement', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/gallery', headers: { cookie } });
  assert.equal(res.json().configured, false);
  res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie, ...H }, payload: { deviceId } });
  assert.equal(res.statusCode, 400);

  // Clé trop courte refusée.
  const weak = (crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  res = await app.inject({ method: 'POST', url: '/api/gallery/setup', headers: { cookie, ...H }, payload: { publicKey: weak, privateKeyEnc, kdf } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/api/gallery/setup', headers: { cookie, ...H }, payload: { publicKey: spki, privateKeyEnc, kdf: { ...kdf, iterations: 1000 } } });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: 'POST', url: '/api/gallery/setup', headers: { cookie, ...H }, payload: { publicKey: spki, privateKeyEnc, kdf } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'POST', url: '/api/gallery/setup', headers: { cookie, ...H }, payload: { publicKey: spki, privateKeyEnc, kdf } });
  assert.equal(res.statusCode, 400, 'déjà configurée');

  res = await app.inject({ method: 'GET', url: '/api/gallery', headers: { cookie } });
  const g = res.json();
  assert.equal(g.configured, true);
  assert.equal(g.keys.publicKey, spki);
  assert.equal(g.keys.privateKeyEnc, privateKeyEnc);
  assert.equal(g.keys.kdf.iterations, 600000);
  assert.deepEqual(g.devices.map((d: { id: number }) => d.id), [deviceId]);
});

test('enregistrement complet : réveil, démarrage, morceaux chiffrés, arrêt, déchiffrement', async () => {
  // L'écran attend (requête longue) : la demande d'enregistrement le réveille aussitôt.
  const waiting = app.inject({ method: 'GET', url: '/api/v1/wait?timeout=20', headers: bearer(token) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(waitingCount(deviceId), 1);
  let res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie, ...H }, payload: { deviceId } });
  assert.equal(res.statusCode, 200);
  const videoId = res.json().id as string;
  assert.equal(res.json().status, 'waiting');
  assert.deepEqual((await waiting).json(), { wake: true });

  // Un seul enregistrement à la fois par écran.
  res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie, ...H }, payload: { deviceId } });
  assert.equal(res.statusCode, 400);

  // Commande transmise dans l'état, avec la clé publique.
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(token) });
  const cmd = res.json().commands.find((c: { type: string }) => c.type === 'record_start');
  assert.ok(cmd);
  assert.deepEqual(JSON.parse(cmd.text), { videoId, publicKey: spki });

  const { key, prefix, wrapped } = deviceKeys();
  res = await app.inject({ method: 'POST', url: `/api/v1/gallery/${videoId}/start`, headers: bearer(token), payload: { wrappedKey: wrapped.toString('base64'), noncePrefix: prefix.toString('base64') } });
  assert.equal(res.statusCode, 200);

  const parts = [crypto.randomBytes(5000), crypto.randomBytes(7000), Buffer.from('fin')];
  const send = (n: number, final: boolean, extra: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/gallery/${videoId}/chunks/${n}`,
      headers: { ...bearer(token), 'content-type': 'application/octet-stream', ...(final ? { 'x-final': '1', 'x-duration-ms': '4200' } : {}), ...extra },
      payload: seal(key, prefix, videoId, n, final, parts[n]),
    });
  res = await send(0, false);
  assert.deepEqual(res.json(), { stop: false });
  res = await send(0, false); // nouvel essai du même morceau : accepté sans doublon
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'POST', url: `/api/v1/gallery/${videoId}/chunks/5`, headers: { ...bearer(token), 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(100) });
  assert.equal(res.statusCode, 409, 'trou dans la numérotation');

  // Arrêt demandé par la console : l'écran l'apprend dans la réponse du morceau suivant.
  res = await app.inject({ method: 'POST', url: `/api/gallery/videos/${videoId}/stop`, headers: { cookie, ...H } });
  assert.equal(res.json().stopRequested, true);
  res = await send(1, false);
  assert.deepEqual(res.json(), { stop: true });
  res = await send(2, true);
  assert.equal(res.statusCode, 200);

  // La console relit tout et déchiffre comme le ferait le navigateur.
  res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${videoId}`, headers: { cookie } });
  const meta = res.json();
  assert.equal(meta.status, 'done');
  assert.equal(meta.complete, true);
  assert.equal(meta.chunks, 3);
  assert.equal(meta.durationMs, 4200);
  const unwrapped = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(meta.wrappedKey, 'base64'));
  const vKey = unwrapped.subarray(0, 32);
  const vPrefix = Buffer.from(meta.noncePrefix, 'base64');
  const out: Buffer[] = [];
  for (let n = 0; n < meta.chunks; n++) {
    res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${videoId}/chunks/${n}`, headers: { cookie } });
    assert.equal(res.statusCode, 200);
    const data = res.rawPayload;
    const iv = Buffer.alloc(12);
    vPrefix.copy(iv);
    iv.writeUInt32BE(n, 8);
    const d = crypto.createDecipheriv('aes-256-gcm', vKey, iv);
    d.setAAD(Buffer.from(`sdv1:${videoId}:${n}:${n === meta.chunks - 1 ? 1 : 0}`));
    d.setAuthTag(data.subarray(data.length - 16));
    out.push(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]));
  }
  assert.ok(Buffer.concat(out).equals(Buffer.concat(parts)));

  // Sur le disque : uniquement du chiffré (le texte « fin » n'apparaît nulle part).
  const files = fs.readdirSync(path.join(tmp, 'gallery'), { recursive: true }).map(String).filter((f) => f.endsWith('.bin'));
  assert.equal(files.length, 3);
  for (const f of files) assert.ok(!fs.readFileSync(path.join(tmp, 'gallery', f)).includes(Buffer.from('fin')));

  // Après la fin : plus de morceaux acceptés, la commande n'est plus active.
  res = await app.inject({ method: 'POST', url: `/api/v1/gallery/${videoId}/chunks/3`, headers: { ...bearer(token), 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(100) });
  assert.equal(res.statusCode, 409);
  res = await app.inject({ method: 'GET', url: '/api/gallery', headers: { cookie } });
  assert.equal(res.json().devices[0].busy, false);
  assert.equal(res.json().videos.length, 1);
  assert.equal(res.json().usedBytes, meta.bytes);
});

test('isolement : un autre compte ne voit ni ne lit les vidéos', async () => {
  assert.match(other, /^sd_session=/, 'second compte créé');
  let res = await app.inject({ method: 'GET', url: '/api/gallery', headers: { cookie: other } });
  assert.equal(res.json().configured, false);
  assert.deepEqual(res.json().videos, []);
  const id = (main().prepare('SELECT id FROM gallery_videos LIMIT 1').get() as { id: string }).id;
  res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${id}`, headers: { cookie: other } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${id}/chunks/0`, headers: { cookie: other } });
  assert.equal(res.statusCode, 404);
  // Ni enregistrer sur l'écran d'un autre foyer.
  res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie: other, ...H }, payload: { deviceId } });
  assert.equal(res.statusCode, 404);
});

test('demande expirée, annulation avant démarrage et échec de l’écran', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie, ...H }, payload: { deviceId } });
  const late = res.json().id as string;
  // Trois minutes plus tard : l'écran ne doit plus démarrer.
  main().prepare('UPDATE gallery_videos SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 3 * 60_000).toISOString(), late);
  const hdb = (await import('../src/households.js')).household(1);
  hdb.prepare("UPDATE commands SET created_at = ? WHERE type = 'record_start'").run(new Date(Date.now() - 3 * 60_000).toISOString());
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(token) });
  assert.equal(res.json().commands.filter((c: { type: string }) => c.type === 'record_start').length, 0);
  res = await app.inject({ method: 'POST', url: `/api/v1/gallery/${late}/start`, headers: bearer(token), payload: { wrappedKey: deviceKeys().wrapped.toString('base64'), noncePrefix: crypto.randomBytes(8).toString('base64') } });
  assert.equal(res.statusCode, 409);
  res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${late}`, headers: { cookie } });
  assert.equal(res.json().status, 'cancelled');

  // Arrêt avant que l'écran ait démarré.
  res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie, ...H }, payload: { deviceId } });
  const early = res.json().id as string;
  res = await app.inject({ method: 'POST', url: `/api/gallery/videos/${early}/stop`, headers: { cookie, ...H } });
  assert.equal(res.json().status, 'cancelled');
  res = await app.inject({ method: 'POST', url: `/api/v1/gallery/${early}/start`, headers: bearer(token), payload: { wrappedKey: deviceKeys().wrapped.toString('base64'), noncePrefix: crypto.randomBytes(8).toString('base64') } });
  assert.equal(res.statusCode, 409);

  // Caméra en panne : l'écran le signale.
  res = await app.inject({ method: 'POST', url: '/api/gallery/record', headers: { cookie, ...H }, payload: { deviceId } });
  const broken = res.json().id as string;
  res = await app.inject({ method: 'POST', url: `/api/v1/gallery/${broken}/fail`, headers: bearer(token), payload: { message: 'Caméra introuvable' } });
  res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${broken}`, headers: { cookie } });
  assert.equal(res.json().status, 'cancelled');
  assert.equal(res.json().error, 'Caméra introuvable');

  // Suppression d'une vidéo.
  res = await app.inject({ method: 'DELETE', url: `/api/gallery/videos/${broken}`, headers: { cookie, ...H } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: `/api/gallery/videos/${broken}`, headers: { cookie } });
  assert.equal(res.statusCode, 404);
});

test('changement de code puis réinitialisation complète', async () => {
  const kdf2 = { ...kdf, salt: crypto.randomBytes(16).toString('base64') };
  let res = await app.inject({ method: 'PUT', url: '/api/gallery/code', headers: { cookie, ...H }, payload: { privateKeyEnc: crypto.randomBytes(1300).toString('base64'), kdf: kdf2 } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/gallery', headers: { cookie } });
  assert.equal(res.json().keys.kdf.salt, kdf2.salt);
  assert.equal(res.json().keys.publicKey, spki, 'même paire de clés : les vidéos restent lisibles');

  res = await app.inject({ method: 'POST', url: '/api/gallery/reset', headers: { cookie, ...H }, payload: {} });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/api/gallery/reset', headers: { cookie, ...H }, payload: { confirm: 'EFFACER' } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/gallery', headers: { cookie } });
  assert.equal(res.json().configured, false);
  assert.equal(fs.readdirSync(path.join(tmp, 'gallery')).length, 0);
});

test('attente longue : immédiate si une commande attend, sinon fin au bout du délai', async () => {
  // Des commandes non acquittées (tests précédents) : réponse immédiate.
  let res = await app.inject({ method: 'GET', url: '/api/v1/wait?timeout=20', headers: bearer(token) });
  assert.deepEqual(res.json(), { wake: true });
  res = await app.inject({ method: 'GET', url: '/api/v1/state', headers: bearer(token) });
  const ids = res.json().commands.map((c: { id: number }) => c.id);
  await app.inject({ method: 'POST', url: '/api/v1/heartbeat', headers: bearer(token), payload: { ackCommands: ids } });
  const t0 = Date.now();
  res = await app.inject({ method: 'GET', url: '/api/v1/wait?timeout=1', headers: bearer(token) });
  assert.deepEqual(res.json(), { wake: false });
  assert.ok(Date.now() - t0 >= 900);
  assert.equal(waitingCount(deviceId), 0);
});
