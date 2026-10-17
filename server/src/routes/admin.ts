import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
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
import { createAlarm, deleteAlarm, getRoutine, listAlarms, saveRoutine, updateAlarm } from '../alarms.js';
import {
  createPairingCode,
  deviceInfo,
  getDeviceRow,
  queueCommand,
  saveDisplay,
  saveLayout,
  setPin,
  unpair,
} from '../device.js';
import {
  ConfigError,
  getDef,
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
import { errorMessage } from '../http.js';

type Body = Record<string, unknown>;

function idParam(params: unknown): number {
  const id = Number((params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Identifiant invalide.');
  return id;
}

function integrationId(params: unknown): IntegrationId {
  const id = (params as { id: string }).id;
  if (!getDef(id)) throw new ConfigError('Intégration inconnue.');
  return id as IntegrationId;
}

export function adminRoutes(app: FastifyInstance, db: DB): void {
  const auth = { preHandler: requireSession };

  // ------------------------------------------------------------ vue d'ensemble
  app.get('/api/overview', auth, async () => {
    const book = new HabitBook(db);
    const today = book.dayStats(book.today);
    const dev = deviceInfo(db);
    return {
      device: {
        paired: dev.paired,
        online: dev.online,
        name: dev.name,
        lastSeenAt: dev.lastSeenAt,
        battery: dev.battery,
        charging: dev.charging,
        firmware: dev.firmware,
        rssi: dev.rssi,
        ip: dev.ip,
        autonomyDays: dev.autonomyDays,
      },
      lastSync: dev.lastSyncAt,
      today: { date: book.today, done: today.done, total: today.total, streak: book.streak(), bestStreak: book.bestStreak() },
      services: [...servicesSummary(db), { id: 'iphone', name: 'iPhone (Bluetooth)', status: 'local', detail: 'Géré directement par la tablette' }],
      events: recentEvents(db, 50),
    };
  });

  app.post('/api/sync', auth, async () => {
    await runAll(db);
    logEvent(db, 'console', 'info', 'Synchronisation manuelle lancée');
    return { ok: true };
  });

  app.post('/api/device/commands', auth, async (req) => {
    const { type, text } = (req.body ?? {}) as Body;
    return { id: queueCommand(db, type, text) };
  });

  app.get('/api/device/screenshot.jpg', auth, async (_req, reply) => {
    const file = path.join(config.dataDir, 'screenshot.jpg');
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not_found', message: 'Aucune capture pour l’instant.' });
    const st = fs.statSync(file);
    reply.header('Cache-Control', 'no-store');
    reply.header('Last-Modified', st.mtime.toUTCString());
    reply.header('ETag', `"${st.size}-${st.mtimeMs.toFixed(0)}"`);
    reply.header('Content-Length', String(st.size));
    return reply.type('image/jpeg').send(fs.createReadStream(file));
  });

  // ------------------------------------------------------------ habitudes
  app.get('/api/habits', auth, async (req) => {
    const archived = (req.query as { archived?: string }).archived === '1';
    const book = new HabitBook(db);
    return book.habits.filter((h) => !!h.archived === archived).map((h) => toDto(book, h));
  });

  app.post('/api/habits', auth, async (req) => {
    const id = createHabit(db, (req.body ?? {}) as Body);
    const book = new HabitBook(db);
    return toDto(book, book.habits.find((h) => h.id === id)!);
  });

  app.patch('/api/habits/:id', auth, async (req, reply) => {
    const id = idParam(req.params);
    if (!updateHabit(db, id, (req.body ?? {}) as Body)) return reply.code(404).send({ error: 'not_found', message: 'Habitude introuvable.' });
    const book = new HabitBook(db);
    return toDto(book, book.habits.find((h) => h.id === id)!);
  });

  app.delete('/api/habits/:id', auth, async (req, reply) => {
    const id = idParam(req.params);
    const ok = db.prepare('DELETE FROM habits WHERE id = ?').run(id).changes > 0;
    if (!ok) return reply.code(404).send({ error: 'not_found', message: 'Habitude introuvable.' });
    return { ok: true };
  });

  app.post('/api/habits/reorder', auth, async (req) => {
    const { ids } = (req.body ?? {}) as Body;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) throw new ValidationError('Liste invalide.');
    const upd = db.prepare('UPDATE habits SET position = ? WHERE id = ?');
    db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
    return { ok: true };
  });

  app.get('/api/streak-settings', auth, async () => getStreakSettings(db));
  app.put('/api/streak-settings', auth, async (req) => saveStreakSettings(db, (req.body ?? {}) as Body));

  app.get('/api/badges', auth, async () => computeBadges(new HabitBook(db)));

  app.get('/api/history', auth, async (req) => {
    const days = Math.max(1, Math.min(365, Number((req.query as { days?: string }).days ?? 30) || 30));
    return new HabitBook(db).history(days);
  });

  app.get('/api/sport-goal', auth, async () => ({ sportGoal: getSetting<number>(db, 'sportGoal', 12) }));
  app.put('/api/sport-goal', auth, async (req) => {
    const v = Number(((req.body ?? {}) as Body).sportGoal);
    if (!Number.isInteger(v) || v < 1 || v > 62) throw new ValidationError('Objectif entre 1 et 62 séances.');
    setSetting(db, 'sportGoal', v);
    return { sportGoal: v };
  });

  // ------------------------------------------------------------ réveils
  app.get('/api/alarms', auth, async () => listAlarms(db));
  app.post('/api/alarms', auth, async (req) => createAlarm(db, (req.body ?? {}) as Body));
  app.patch('/api/alarms/:id', auth, async (req, reply) => {
    const a = updateAlarm(db, idParam(req.params), (req.body ?? {}) as Body);
    if (!a) return reply.code(404).send({ error: 'not_found', message: 'Alarme introuvable.' });
    return a;
  });
  app.delete('/api/alarms/:id', auth, async (req, reply) => {
    if (!deleteAlarm(db, idParam(req.params))) return reply.code(404).send({ error: 'not_found', message: 'Alarme introuvable.' });
    return { ok: true };
  });
  app.get('/api/routine', auth, async () => getRoutine(db));
  app.put('/api/routine', auth, async (req) => saveRoutine(db, (req.body ?? {}) as Body));

  // ------------------------------------------------------------ appareil
  app.get('/api/device', auth, async () => deviceInfo(db));
  app.put('/api/device/settings', auth, async (req) => saveDisplay(db, (req.body ?? {}) as Body));
  app.put('/api/device/layout', auth, async (req) => {
    saveLayout(db, ((req.body ?? {}) as Body).widgets);
    return { ok: true };
  });
  app.put('/api/device/pin', auth, async (req) => {
    setPin(db, ((req.body ?? {}) as Body).pin);
    return { ok: true };
  });
  app.post('/api/device/pairing-code', auth, async () => createPairingCode(db));
  app.post('/api/device/regenerate-token', auth, async () => {
    unpair(db);
    return { ok: true };
  });
  app.delete('/api/device', auth, async () => {
    unpair(db);
    return { ok: true };
  });

  app.get('/api/backup', auth, async (_req, reply) => {
    const name = `smart-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return exportBackup(db);
  });
  app.post('/api/backup', { ...auth, bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    importBackup(db, req.body);
    return { ok: true };
  });

  // ------------------------------------------------------------ intégrations
  app.get('/api/integrations', auth, async () => listIntegrations(db));

  app.put('/api/integrations/:id', auth, async (req) => {
    const id = integrationId(req.params);
    updateIntegration(db, id, (req.body ?? {}) as Body);
    // Mise à jour immédiate en arrière-plan.
    void runIntegration(db, id, 'manual');
    return integrationDto(db, getDef(id)!);
  });

  app.post('/api/integrations/:id/test', auth, async (req) => testIntegration(db, integrationId(req.params)));

  app.post('/api/integrations/:id/refresh', auth, async (req, reply) => {
    const res = await runIntegration(db, integrationId(req.params), 'manual');
    if (!res.ok) return reply.code(502).send({ error: 'refresh_failed', message: res.message });
    return { ok: true };
  });

  app.get('/api/integrations/:id/secret/:field', auth, async (req) => {
    const { field } = req.params as { field: string };
    return { value: revealSecret(db, integrationId(req.params), field) };
  });

  app.get('/api/integrations/spotify/connect', auth, async (_req, reply) => {
    const ctx = makeContext(db, 'spotify');
    if (!ctx.config.clientId || !ctx.secrets.clientSecret) {
      return reply.redirect('/integrations?spotify=missing');
    }
    return reply.redirect(buildAuthorizeUrl(ctx.config.clientId));
  });

  // Callback OAuth : au retour de Spotify, le cookie SameSite=Strict n'est pas envoyé
  // (navigation venant d'un autre site). Le paramètre `state`, émis lors de /connect
  // par une session authentifiée et à usage unique, sert de preuve.
  app.get('/api/oauth/spotify/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error || !q.code || !q.state || !consumeState(q.state)) {
      logEvent(db, 'spotify', 'error', `Connexion Spotify refusée${q.error ? ` (${q.error})` : ''}`);
      return reply.redirect('/integrations?spotify=error');
    }
    try {
      const ctx = makeContext(db, 'spotify');
      await exchangeCode(ctx, q.code);
      db.prepare('UPDATE integrations SET enabled = 1, last_run_at = NULL WHERE id = ?').run('spotify');
      logEvent(db, 'spotify', 'success', `Compte Spotify connecté (${ctx.config.account})`);
      void runIntegration(db, 'spotify', 'manual');
      return reply.redirect('/integrations?spotify=connected');
    } catch (err) {
      logEvent(db, 'spotify', 'error', `Connexion Spotify : ${errorMessage(err)}`);
      return reply.redirect('/integrations?spotify=error');
    }
  });

  app.post('/api/integrations/roblox/resolve', auth, async (req) => {
    const { placeId } = (req.body ?? {}) as Body;
    return resolvePlaceId(String(placeId ?? '').trim());
  });

  app.get('/api/integrations/pathe/cinemas', auth, async () => listCinemas(db));

  app.get('/api/integrations/icloud/calendars', auth, async () => {
    const ctx = makeContext(db, 'icloud');
    if (getDef('icloud')!.missing(ctx)) throw new ConfigError('Enregistre d’abord ton identifiant Apple et ton mot de passe pour app.');
    return listCalendars(ctx);
  });

  // Info appareil brute (utile au débogage depuis la console).
  app.get('/api/device/raw', auth, async () => getDeviceRow(db));
}
