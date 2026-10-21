// API de la tablette (/api/v1) : chaque écran s'authentifie avec son jeton et ne voit que
// les données de son foyer, ses réveils et ses réglages.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import {
  buildDeviceState,
  pendingCommands,
  deviceFromAuthHeader,
  pairDevice,
  recordHeartbeat,
  saveDeviceDisplay,
  screenshotFile,
  tasksForDevice,
  type DeviceRow,
} from '../device.js';
import { HabitBook, ValidationError, setHabitDone } from '../habits.js';
import { getAlarm, updateAlarm } from '../alarms.js';
import { getDef, isAvailable, isEnabled, makeContext } from '../integrations/index.js';
import { control } from '../integrations/spotify.js';
import { filmDetails, setCinemaAlert } from '../integrations/pathe.js';
import { agendaRange } from '../integrations/icloud.js';
import { isAllowedImage, processImage, rgb565ToJpeg } from '../images.js';
import { logEvent } from '../events.js';
import { HttpError } from '../http.js';
import { household, householdActive } from '../households.js';
import { deviceSafe } from '../deviceText.js';
import { sha256 } from '../crypto.js';
import { waitForWake } from '../wake.js';
import { GalleryConflict, MAX_CHUNK_BYTES, deviceChunk, deviceFail, deviceStart } from '../gallery.js';

type Body = Record<string, unknown>;

/** Empreinte de l'état, sans ce qui change à chaque requête (heure, avancement du morceau). */
function hashState(state: Record<string, unknown>): string {
  return sha256(
    JSON.stringify(state, (k, v) => (k === 'serverTime' || k === 'progressMs' ? undefined : v)),
  ).slice(0, 16);
}

// Codes d'appairage : 6 chiffres partagés par tous les foyers. En plus de la limite par
// adresse, un plafond global d'échecs empêche de les deviner depuis de nombreuses adresses.
const PAIR_WINDOW_MS = 10 * 60_000;
const PAIR_MAX_FAILURES = 30;
const pairFailures: number[] = [];
function pairingLocked(now = Date.now()): boolean {
  while (pairFailures.length && pairFailures[0] < now - PAIR_WINDOW_MS) pairFailures.shift();
  return pairFailures.length >= PAIR_MAX_FAILURES;
}
/** Pour les tests. */
export function resetPairingGuard(): void {
  pairFailures.length = 0;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceRow;
  }
}

export function deviceRoutes(app: FastifyInstance, mainDb: DB): void {
  async function requireDevice(req: FastifyRequest, reply: FastifyReply) {
    const d = deviceFromAuthHeader(req.headers.authorization);
    if (!d) {
      await reply.code(401).send({ error: 'device_unauthorized', message: 'Jeton de la tablette invalide : ré-appaire l’écran.' });
      return;
    }
    if (!householdActive(d.household_id)) {
      await reply.code(403).send({ error: 'account_disabled', message: 'Le compte de ce foyer a été désactivé par l’administrateur.' });
      return;
    }
    req.device = d;
    req.hdb = household(d.household_id);
  }
  const dev = { preHandler: requireDevice };

  app.post('/api/v1/pair', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    if (pairingLocked()) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Trop de codes refusés : réessaie dans quelques minutes.' });
    }
    const { code, name, firmware } = (req.body ?? {}) as Body;
    const res = pairDevice(code, name, firmware);
    if (!res) {
      pairFailures.push(Date.now());
      if (pairingLocked()) logEvent(mainDb, 'device', 'error', 'Appairage suspendu 10 min : trop de codes refusés (tentative de deviner un code ?)');
      else logEvent(mainDb, 'device', 'warning', `Code d’appairage refusé (${req.ip})`);
      return reply.code(401).send({ error: 'invalid_code', message: 'Code invalide ou expiré.' });
    }
    return { token: res.token };
  });

  // État complet de l'écran. `?known=<stateHash>` : si rien n'a changé depuis, réponse
  // courte { unchanged: true } (l'écran n'a ni à tout relire ni à redessiner).
  app.get('/api/v1/state', dev, async (req) => {
    const state = deviceSafe(await buildDeviceState(req.device!));
    const stateHash = hashState(state);
    if ((req.query as { known?: string }).known === stateHash) return { unchanged: true, serverTime: state.serverTime, stateHash };
    return { ...state, stateHash };
  });

  app.post('/api/v1/heartbeat', dev, async (req) => {
    recordHeartbeat(req.device!, (req.body ?? {}) as Body, req.ip);
    return { ok: true };
  });

  // Réglages modifiés directement sur l'écran (luminosité, thème, veille…) : cet écran seulement.
  app.put('/api/v1/settings', dev, async (req) => saveDeviceDisplay(req.device!, (req.body ?? {}) as Body));

  app.post('/api/v1/habits/:id/toggle', dev, async (req, reply) => {
    const db = req.hdb!;
    const id = Number((req.params as { id: string }).id);
    const book = new HabitBook(db);
    const habit = book.active.find((h) => h.id === id);
    if (!habit) return reply.code(404).send({ error: 'not_found', message: 'Tâche introuvable.' });
    const { done } = (req.body ?? {}) as Body;
    const target = typeof done === 'boolean' ? done : !book.isDone(habit, book.today);
    setHabitDone(db, id, book.today, target);
    return deviceSafe(tasksForDevice(db));
  });

  app.patch('/api/v1/alarms/:id', dev, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { enabled } = (req.body ?? {}) as Body;
    if (typeof enabled !== 'boolean') throw new ValidationError('« enabled » doit être un booléen.');
    const current = Number.isInteger(id) ? getAlarm(req.hdb!, id) : null;
    if (!current || current.deviceId !== req.device!.id) return reply.code(404).send({ error: 'not_found', message: 'Alarme introuvable.' });
    return updateAlarm(req.hdb!, id, { enabled });
  });

  app.post('/api/v1/music/:action', dev, async (req) => {
    const db = req.hdb!;
    if (!isEnabled(db, 'spotify')) throw new HttpError(409, '', 'Spotify n’est pas activé dans la console.');
    const ctx = makeContext(db, 'spotify');
    const missing = getDef('spotify')!.missing(ctx);
    if (missing) throw new HttpError(409, '', missing);
    const { action } = req.params as { action: string };
    return deviceSafe(await control(ctx, action, ((req.body ?? {}) as Body).value));
  });

  // Calendrier : n'importe quelle période (navigation jour / semaine / mois / année).
  app.get('/api/v1/agenda', dev, async (req) => {
    const db = req.hdb!;
    if (!isAvailable('icloud') || !isEnabled(db, 'icloud')) throw new HttpError(409, '', 'Calendrier iCloud non activé dans la console.');
    const ctx = makeContext(db, 'icloud');
    const missing = getDef('icloud')!.missing(ctx);
    if (missing) throw new HttpError(409, '', missing);
    const { from, to } = req.query as { from?: string; to?: string };
    return deviceSafe(await agendaRange(ctx, String(from ?? ''), String(to ?? '')));
  });

  // Fiche d'un film : résumé, réalisation, distribution, bande-annonce.
  app.get('/api/v1/cinema/film/:id', dev, async (req, reply) => {
    const details = filmDetails(req.hdb!, (req.params as { id: string }).id);
    if (!details) return reply.code(404).send({ error: 'not_found', message: 'Film introuvable.' });
    return deviceSafe(details);
  });

  app.post('/api/v1/cinema/notify/:id', dev, async (req) => {
    const { id } = req.params as { id: string };
    setCinemaAlert(req.hdb!, id, !!((req.body ?? {}) as Body).notify);
    return { ok: true };
  });

  app.get('/api/v1/image', dev, async (req, reply) => {
    const q = req.query as { src?: string; w?: string; h?: string };
    if (!q.src || !isAllowedImage(q.src)) return reply.code(400).send({ error: 'bad_image', message: 'Image non autorisée.' });
    const img = await processImage(q.src, Number(q.w ?? 176), Number(q.h ?? 256));
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(img);
  });

  // Attente longue : se termine dès que la console envoie quelque chose à cet écran
  // (commande, enregistrement…), sinon au bout de 25 s. L'écran relit alors son état.
  app.get('/api/v1/wait', dev, async (req) => {
    // Commande arrivée pendant que l'écran n'écoutait pas (entre deux attentes) : tout de suite.
    if (pendingCommands(req.hdb!, req.device!.id).length > 0) return { wake: true };
    const ms = Math.min(Math.max(Number((req.query as { timeout?: string }).timeout ?? 25) || 25, 1), 25) * 1000;
    const woken = await waitForWake(req.device!.id, ms, (cb) => req.raw.on('close', cb));
    return { wake: woken };
  });

  // ------------------------------------------------------------ galerie (vidéos chiffrées)
  const galleryErrors = async (reply: FastifyReply, fn: () => unknown) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GalleryConflict) return reply.code(409).send({ error: 'gallery_conflict', message: err.message });
      throw err;
    }
  };

  app.post('/api/v1/gallery/:id/start', dev, async (req, reply) =>
    galleryErrors(reply, () => {
      deviceStart(req.device!, (req.params as { id: string }).id, (req.body ?? {}) as Body);
      return { ok: true };
    }),
  );

  app.post('/api/v1/gallery/:id/chunks/:n', { ...dev, bodyLimit: MAX_CHUNK_BYTES + 1024 }, async (req, reply) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) return reply.code(400).send({ error: 'bad_body', message: 'Corps binaire attendu.' });
    const { id, n } = req.params as { id: string; n: string };
    const final = req.headers['x-final'] === '1';
    const dur = req.headers['x-duration-ms'];
    return galleryErrors(reply, () => deviceChunk(req.device!, id, Number(n), body, final, dur === undefined ? null : Number(dur)));
  });

  app.post('/api/v1/gallery/:id/fail', dev, async (req) => {
    deviceFail(req.device!, (req.params as { id: string }).id, ((req.body ?? {}) as Body).message);
    return { ok: true };
  });

  // Capture d'écran (RGB565 brut) envoyée à la demande de la console.
  app.post('/api/v1/screenshot', { ...dev, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const w = Number(req.headers['x-width']);
    const h = Number(req.headers['x-height']);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 2048 || h > 2048) {
      return reply.code(400).send({ error: 'bad_size', message: 'Dimensions invalides.' });
    }
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) return reply.code(400).send({ error: 'bad_body', message: 'Corps binaire attendu.' });
    const jpg = await rgb565ToJpeg(body, w, h);
    const file = screenshotFile(req.device!.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, jpg);
    return { ok: true };
  });
}
