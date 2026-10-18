// Routes du panel « foyer » : chaque compte gère les données de son propre foyer
// (req.hdb = base de ce foyer) et ses écrans.
import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import { getSetting, setSetting } from '../db.js';
import { requireSession } from '../auth.js';
import { recentEvents, logEvent } from '../events.js';
import {
  HabitBook,
  ValidationError,
  computeBadges,
  createHabit,
  getStreakSettings,
  saveStreakSettings,
  toDto,
  updateHabit,
} from '../habits.js';
import { createAlarm, deleteAlarm, getAlarm, getRoutine, listAlarms, saveRoutine, updateAlarm } from '../alarms.js';
import {
  broadcastMessage,
  createPairingCode,
  deviceInfo,
  deviceSummary,
  getHouseholdDevice,
  getPin,
  listDevices,
  queueCommand,
  removeDevice,
  renameDevice,
  saveDeviceDisplay,
  saveDeviceLayout,
  screenshotFile,
  setPin,
  type DeviceRow,
} from '../device.js';
import {
  ConfigError,
  getDef,
  isAvailable,
  listIntegrations,
  makeContext,
  revealSecret,
  runAll,
  runIntegration,
  servicesSummary,
  testIntegration,
  toDto as integrationDto,
  updateIntegration,
  type IntegrationId,
} from '../integrations/index.js';
import { buildAuthorizeUrl, consumeState, exchangeCode } from '../integrations/spotify.js';
import { resolvePlaceId } from '../integrations/roblox.js';
import { listCinemas } from '../integrations/pathe.js';
import { listCalendars } from '../integrations/icloud.js';
import { exportBackup, importBackup } from '../backup.js';
import { NotFoundError, errorMessage } from '../http.js';
import { getHousehold, household } from '../households.js';

type Body = Record<string, unknown>;

function idParam(params: unknown, key = 'id'): number {
  const id = Number((params as Record<string, string>)[key]);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Identifiant invalide.');
  return id;
}

function integrationId(params: unknown): IntegrationId {
  const id = (params as { id: string }).id;
  if (!getDef(id) || !isAvailable(id)) throw new ConfigError('Intégration inconnue.');
  return id as IntegrationId;
}

export function householdRoutes(app: FastifyInstance, mainDb: DB): void {
  const auth = { preHandler: requireSession };
  const hdb = (req: FastifyRequest): DB => req.hdb!;
  const hid = (req: FastifyRequest): number => req.user!.household_id;

  /** Écran du foyer de l'utilisateur (404 sinon, même s'il existe dans un autre foyer). */
  function screen(req: FastifyRequest): DeviceRow {
    const d = getHouseholdDevice(hid(req), idParam(req.params));
    if (!d) throw new NotFoundError('Écran introuvable.');
    return d;
  }

  // ------------------------------------------------------------ vue d'ensemble
  app.get('/api/overview', auth, async (req) => {
    const db = hdb(req);
    const book = new HabitBook(db);
    const today = book.dayStats(book.today);
    const devices = listDevices(hid(req)).map(deviceSummary);
    return {
      devices,
      today: { date: book.today, done: today.done, total: today.total, streak: book.streak(), bestStreak: book.bestStreak() },
      services: [...servicesSummary(db), { id: 'iphone', name: 'iPhone (Bluetooth)', status: 'local', detail: 'Géré directement par chaque écran' }],
      events: recentEvents(db, 50),
    };
  });

  const syncLimit = { rateLimit: { max: 6, timeWindow: '1 minute' } };
  app.post('/api/sync', { ...auth, config: syncLimit }, async (req) => {
    await runAll(hdb(req));
    logEvent(hdb(req), 'console', 'info', 'Synchronisation manuelle lancée');
    return { ok: true };
  });

  // ------------------------------------------------------------ habitudes (communes au foyer)
  app.get('/api/habits', auth, async (req) => {
    const archived = (req.query as { archived?: string }).archived === '1';
    const book = new HabitBook(hdb(req));
    return book.habits.filter((h) => !!h.archived === archived).map((h) => toDto(book, h));
  });

  app.post('/api/habits', auth, async (req) => {
    const id = createHabit(hdb(req), (req.body ?? {}) as Body);
    const book = new HabitBook(hdb(req));
    return toDto(book, book.habits.find((h) => h.id === id)!);
  });

  app.patch('/api/habits/:id', auth, async (req, reply) => {
    const id = idParam(req.params);
    if (!updateHabit(hdb(req), id, (req.body ?? {}) as Body)) return reply.code(404).send({ error: 'not_found', message: 'Habitude introuvable.' });
    const book = new HabitBook(hdb(req));
    return toDto(book, book.habits.find((h) => h.id === id)!);
  });

  app.delete('/api/habits/:id', auth, async (req, reply) => {
    const ok = hdb(req).prepare('DELETE FROM habits WHERE id = ?').run(idParam(req.params)).changes > 0;
    if (!ok) return reply.code(404).send({ error: 'not_found', message: 'Habitude introuvable.' });
    return { ok: true };
  });

  app.post('/api/habits/reorder', auth, async (req) => {
    const { ids } = (req.body ?? {}) as Body;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) throw new ValidationError('Liste invalide.');
    const db = hdb(req);
    const upd = db.prepare('UPDATE habits SET position = ? WHERE id = ?');
    db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
    return { ok: true };
  });

  app.get('/api/streak-settings', auth, async (req) => getStreakSettings(hdb(req)));
  app.put('/api/streak-settings', auth, async (req) => saveStreakSettings(hdb(req), (req.body ?? {}) as Body));
  app.get('/api/badges', auth, async (req) => computeBadges(new HabitBook(hdb(req))));

  app.get('/api/history', auth, async (req) => {
    const days = Math.max(1, Math.min(365, Number((req.query as { days?: string }).days ?? 30) || 30));
    return new HabitBook(hdb(req)).history(days);
  });

  app.get('/api/sport-goal', auth, async (req) => ({ sportGoal: getSetting<number>(hdb(req), 'sportGoal', 12) }));
  app.put('/api/sport-goal', auth, async (req) => {
    const v = Number(((req.body ?? {}) as Body).sportGoal);
    if (!Number.isInteger(v) || v < 1 || v > 62) throw new ValidationError('Objectif entre 1 et 62 séances.');
    setSetting(hdb(req), 'sportGoal', v);
    return { sportGoal: v };
  });

  // ------------------------------------------------------------ écrans du foyer
  app.get('/api/devices', auth, async (req) => listDevices(hid(req)).map(deviceSummary));

  /** Code d'appairage : nouvel écran, ou ré-association d'un écran existant (deviceId). */
  app.post('/api/devices/pairing-code', auth, async (req) => {
    const { name, deviceId } = (req.body ?? {}) as Body;
    return createPairingCode(hid(req), { name, deviceId: deviceId === undefined || deviceId === null ? undefined : Number(deviceId) });
  });

  /** Message affiché sur tous les écrans associés du foyer. */
  app.post('/api/devices/broadcast', auth, async (req) => {
    const { text } = (req.body ?? {}) as Body;
    if (typeof text !== 'string' || !text.trim() || text.length > 140) throw new ValidationError('Le message doit faire entre 1 et 140 caractères.');
    const paired = listDevices(hid(req)).filter((d) => d.token_hash);
    if (paired.length === 0) throw new ValidationError('Aucun écran associé.');
    broadcastMessage(hdb(req), hid(req), text.trim());
    logEvent(hdb(req), 'console', 'info', `Message envoyé à tous les écrans : « ${text.trim()} »`);
    return { ok: true, screens: paired.length };
  });

  app.get('/api/devices/:id', auth, async (req) => deviceInfo(screen(req), hdb(req)));

  app.patch('/api/devices/:id', auth, async (req) => {
    const d = screen(req);
    renameDevice(d, ((req.body ?? {}) as Body).name);
    return deviceInfo(getHouseholdDevice(hid(req), d.id)!, hdb(req));
  });

  app.delete('/api/devices/:id', auth, async (req) => {
    removeDevice(screen(req));
    return { ok: true };
  });

  app.put('/api/devices/:id/settings', auth, async (req) => saveDeviceDisplay(screen(req), (req.body ?? {}) as Body));
  app.put('/api/devices/:id/layout', auth, async (req) => {
    saveDeviceLayout(screen(req), ((req.body ?? {}) as Body).widgets);
    return { ok: true };
  });

  app.post('/api/devices/:id/commands', auth, async (req) => {
    const { type, text } = (req.body ?? {}) as Body;
    return { id: queueCommand(hdb(req), screen(req), type, text) };
  });

  app.get('/api/devices/:id/screenshot.jpg', auth, async (req, reply) => {
    const file = screenshotFile(screen(req).id);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not_found', message: 'Aucune capture pour l’instant.' });
    const st = fs.statSync(file);
    reply.header('Cache-Control', 'no-store');
    reply.header('Last-Modified', st.mtime.toUTCString());
    reply.header('ETag', `"${st.size}-${st.mtimeMs.toFixed(0)}"`);
    reply.header('Content-Length', String(st.size));
    return reply.type('image/jpeg').send(fs.createReadStream(file));
  });

  // Réveils : propres à chaque écran.
  app.get('/api/devices/:id/alarms', auth, async (req) => listAlarms(hdb(req), screen(req).id));
  app.post('/api/devices/:id/alarms', auth, async (req) => createAlarm(hdb(req), (req.body ?? {}) as Body, screen(req).id));
  app.get('/api/devices/:id/routine', auth, async (req) => getRoutine(hdb(req), screen(req).id));
  app.put('/api/devices/:id/routine', auth, async (req) => saveRoutine(hdb(req), screen(req).id, (req.body ?? {}) as Body));

  app.patch('/api/alarms/:id', auth, async (req, reply) => {
    const id = idParam(req.params);
    if (!getAlarm(hdb(req), id)) return reply.code(404).send({ error: 'not_found', message: 'Alarme introuvable.' });
    return updateAlarm(hdb(req), id, (req.body ?? {}) as Body);
  });
  app.delete('/api/alarms/:id', auth, async (req, reply) => {
    if (!deleteAlarm(hdb(req), idParam(req.params))) return reply.code(404).send({ error: 'not_found', message: 'Alarme introuvable.' });
    return { ok: true };
  });

  // Code PIN commun aux écrans du foyer.
  app.get('/api/pin', auth, async (req) => {
    const pin = getPin(hdb(req));
    return { pinSet: !!pin, pinUpdatedAt: pin?.updatedAt ?? null };
  });
  app.put('/api/pin', auth, async (req) => {
    setPin(hdb(req), ((req.body ?? {}) as Body).pin);
    return { ok: true };
  });

  app.get('/api/backup', auth, async (req, reply) => {
    const name = `smart-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return exportBackup(hdb(req));
  });
  app.post('/api/backup', { ...auth, bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    importBackup(hdb(req), req.body, new Set(listDevices(hid(req)).map((d) => d.id)));
    return { ok: true };
  });

  // ------------------------------------------------------------ services du foyer
  app.get('/api/integrations', auth, async (req) => listIntegrations(hdb(req)));

  app.put('/api/integrations/:id', auth, async (req) => {
    const id = integrationId(req.params);
    updateIntegration(hdb(req), id, (req.body ?? {}) as Body);
    void runIntegration(hdb(req), id, 'manual');
    return integrationDto(hdb(req), getDef(id)!);
  });

  app.post('/api/integrations/:id/test', { ...auth, config: syncLimit }, async (req) => testIntegration(hdb(req), integrationId(req.params)));

  app.post('/api/integrations/:id/refresh', { ...auth, config: syncLimit }, async (req, reply) => {
    const res = await runIntegration(hdb(req), integrationId(req.params), 'manual');
    if (!res.ok) return reply.code(502).send({ error: 'refresh_failed', message: res.message });
    return { ok: true };
  });

  app.get('/api/integrations/:id/secret/:field', auth, async (req) => {
    const { field } = req.params as { field: string };
    return { value: revealSecret(hdb(req), integrationId(req.params), field) };
  });

  app.get('/api/integrations/spotify/connect', auth, async (req, reply) => {
    if (!isAvailable('spotify')) return reply.redirect('/services?spotify=missing');
    const ctx = makeContext(hdb(req), 'spotify');
    if (!ctx.app.clientId || !ctx.app.clientSecret) return reply.redirect('/services?spotify=missing');
    return reply.redirect(buildAuthorizeUrl(ctx.app.clientId, hid(req)));
  });

  // Callback OAuth : au retour de Spotify, le cookie SameSite=Strict n'est pas envoyé
  // (navigation venant d'un autre site). Le paramètre `state`, émis lors de /connect par
  // une session authentifiée, à usage unique et lié au foyer, sert de preuve.
  app.get('/api/oauth/spotify/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const stateHousehold = q.state ? consumeState(q.state) : null;
    // Foyer supprimé pendant la connexion : on ne le recrée pas.
    const householdId = stateHousehold && getHousehold(stateHousehold) ? stateHousehold : null;
    if (q.error || !q.code || !householdId) {
      if (householdId) logEvent(household(householdId), 'spotify', 'error', `Connexion Spotify refusée${q.error ? ` (${q.error})` : ''}`);
      return reply.redirect('/services?spotify=error');
    }
    const db = household(householdId);
    try {
      const ctx = makeContext(db, 'spotify');
      await exchangeCode(ctx, q.code);
      db.prepare('UPDATE integrations SET enabled = 1, last_run_at = NULL WHERE id = ?').run('spotify');
      logEvent(db, 'spotify', 'success', `Compte Spotify connecté (${ctx.config.account})`);
      void runIntegration(db, 'spotify', 'manual');
      return reply.redirect('/services?spotify=connected');
    } catch (err) {
      logEvent(db, 'spotify', 'error', `Connexion Spotify : ${errorMessage(err)}`);
      return reply.redirect('/services?spotify=error');
    }
  });

  app.post('/api/integrations/roblox/resolve', auth, async (req) => {
    const { placeId } = (req.body ?? {}) as Body;
    return resolvePlaceId(String(placeId ?? '').trim());
  });

  app.get('/api/integrations/pathe/cinemas', auth, async (req) => listCinemas(hdb(req)));

  app.get('/api/integrations/icloud/calendars', auth, async (req) => {
    const ctx = makeContext(hdb(req), 'icloud');
    if (getDef('icloud')!.missing(ctx)) throw new ConfigError('Enregistre d’abord ton identifiant Apple et ton mot de passe pour app.');
    return listCalendars(ctx);
  });

  void mainDb;
}
