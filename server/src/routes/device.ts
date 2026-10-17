import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import { config } from '../config.js';
import { buildDeviceState, checkDeviceToken, pairDevice, recordHeartbeat, saveDisplay, tasksForDevice } from '../device.js';
import { HabitBook, ValidationError, setHabitDone } from '../habits.js';
import { updateAlarm } from '../alarms.js';
import { getDef, isEnabled, makeContext } from '../integrations/index.js';
import { control } from '../integrations/spotify.js';
import { setCinemaAlert } from '../integrations/pathe.js';
import { isAllowedImage, processImage, rgb565ToJpeg } from '../images.js';
import { logEvent } from '../events.js';
import { HttpError } from '../http.js';

type Body = Record<string, unknown>;

export function deviceRoutes(app: FastifyInstance, db: DB): void {
  async function requireDevice(req: FastifyRequest, reply: FastifyReply) {
    if (!checkDeviceToken(db, req.headers.authorization)) {
      await reply.code(401).send({ error: 'device_unauthorized', message: 'Jeton de la tablette invalide : ré-appaire l’écran.' });
      return;
    }
    req.deviceAuthed = true;
  }
  const dev = { preHandler: requireDevice };

  app.post('/api/v1/pair', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { code, name, firmware } = (req.body ?? {}) as Body;
    const token = pairDevice(db, code, name, firmware);
    if (!token) {
      logEvent(db, 'device', 'warning', `Code d’appairage refusé (${req.ip})`);
      return reply.code(401).send({ error: 'invalid_code', message: 'Code invalide ou expiré.' });
    }
    return { token };
  });

  app.get('/api/v1/state', dev, async () => buildDeviceState(db));

  app.post('/api/v1/heartbeat', dev, async (req) => {
    recordHeartbeat(db, (req.body ?? {}) as Body, req.ip);
    return { ok: true };
  });

  // Réglages modifiés directement sur l'écran (luminosité, thème, veille…).
  app.put('/api/v1/settings', dev, async (req) => saveDisplay(db, (req.body ?? {}) as Body));

  app.post('/api/v1/habits/:id/toggle', dev, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const book = new HabitBook(db);
    const habit = book.active.find((h) => h.id === id);
    if (!habit) return reply.code(404).send({ error: 'not_found', message: 'Tâche introuvable.' });
    const { done } = (req.body ?? {}) as Body;
    const target = typeof done === 'boolean' ? done : !book.isDone(habit, book.today);
    setHabitDone(db, id, book.today, target);
    return tasksForDevice(db);
  });

  app.patch('/api/v1/alarms/:id', dev, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { enabled } = (req.body ?? {}) as Body;
    if (typeof enabled !== 'boolean') throw new ValidationError('« enabled » doit être un booléen.');
    const a = updateAlarm(db, id, { enabled });
    if (!a) return reply.code(404).send({ error: 'not_found', message: 'Alarme introuvable.' });
    return a;
  });

  app.post('/api/v1/music/:action', dev, async (req) => {
    if (!isEnabled(db, 'spotify')) throw new HttpError(409, '', 'Spotify n’est pas activé dans la console.');
    const ctx = makeContext(db, 'spotify');
    const missing = getDef('spotify')!.missing(ctx);
    if (missing) throw new HttpError(409, '', missing);
    const { action } = req.params as { action: string };
    return control(ctx, action, ((req.body ?? {}) as Body).value);
  });

  app.post('/api/v1/cinema/notify/:id', dev, async (req) => {
    const { id } = req.params as { id: string };
    setCinemaAlert(db, id, !!((req.body ?? {}) as Body).notify);
    return { ok: true };
  });

  app.get('/api/v1/image', dev, async (req, reply) => {
    const q = req.query as { src?: string; w?: string; h?: string };
    if (!q.src || !isAllowedImage(q.src)) return reply.code(400).send({ error: 'bad_image', message: 'Image non autorisée.' });
    const img = await processImage(q.src, Number(q.w ?? 176), Number(q.h ?? 256));
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(img);
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
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, 'screenshot.jpg'), jpg);
    return { ok: true };
  });
}
