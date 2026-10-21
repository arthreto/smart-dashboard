// Galerie de la console : chaque compte ne voit que ses propres vidéos (pas celles des
// autres membres du foyer). Le serveur ne manipule que des données chiffrées.
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { requireSession } from '../auth.js';
import { getHouseholdDevice, listDevices, queueInternalCommand } from '../device.js';
import { ValidationError } from '../habits.js';
import { NotFoundError } from '../http.js';
import { logEvent } from '../events.js';
import {
  changeCode,
  checkVideoId,
  chunkFile,
  createRecording,
  deleteVideo,
  getKeys,
  getVideo,
  listVideos,
  requestStop,
  resetGallery,
  setupKeys,
  usedBytes,
  videoDto,
  activeOnDevice,
} from '../gallery.js';

type Body = Record<string, unknown>;

export function galleryRoutes(app: FastifyInstance, _mainDb: DB): void {
  const auth = { preHandler: requireSession };
  // Peu d'essais : la création de clés et le changement de code n'ont pas à être répétés.
  const keyLimit = { rateLimit: { max: 10, timeWindow: '10 minutes' } };

  /** État de la galerie : clés (publique + privée chiffrée), écrans, vidéos. */
  app.get('/api/gallery', auth, async (req) => {
    const user = req.user!;
    const keys = getKeys(user.id);
    const devices = listDevices(user.household_id)
      .filter((d) => d.token_hash)
      .map((d) => {
        const active = activeOnDevice(d.id);
        return {
          id: d.id,
          name: d.name,
          busy: !!active,
          mine: !!active && active.user_id === user.id,
        };
      });
    return {
      configured: !!keys,
      keys,
      devices,
      videos: keys ? listVideos(user.id) : [],
      usedBytes: keys ? usedBytes(user.id) : 0,
    };
  });

  app.post('/api/gallery/setup', { ...auth, config: keyLimit }, async (req) => {
    setupKeys(req.user!.id, (req.body ?? {}) as Body);
    logEvent(req.hdb!, 'console', 'info', 'Galerie protégée par un code secret');
    return { ok: true };
  });

  app.put('/api/gallery/code', { ...auth, config: keyLimit }, async (req) => {
    changeCode(req.user!.id, (req.body ?? {}) as Body);
    logEvent(req.hdb!, 'console', 'info', 'Code secret de la galerie modifié');
    return { ok: true };
  });

  /** Code oublié : supprime les clés et toutes les vidéos de ce compte. */
  app.post('/api/gallery/reset', auth, async (req) => {
    const { confirm } = (req.body ?? {}) as Body;
    if (confirm !== 'EFFACER') throw new ValidationError('Confirmation manquante.');
    resetGallery(req.user!.id);
    logEvent(req.hdb!, 'console', 'warning', 'Galerie réinitialisée (clés et vidéos effacées)');
    return { ok: true };
  });

  app.post('/api/gallery/record', auth, async (req) => {
    const deviceId = Number(((req.body ?? {}) as Body).deviceId);
    const d = Number.isInteger(deviceId) ? getHouseholdDevice(req.user!.household_id, deviceId) : undefined;
    if (!d) throw new NotFoundError('Écran introuvable.');
    const { video, command } = createRecording(req.user!.id, d);
    queueInternalCommand(req.hdb!, d, 'record_start', command);
    logEvent(req.hdb!, 'console', 'info', `Enregistrement demandé sur « ${d.name} »`);
    return videoDto(video);
  });

  app.post('/api/gallery/videos/:id/stop', auth, async (req) => videoDto(requestStop(req.user!.id, (req.params as { id: string }).id)));

  app.get('/api/gallery/videos/:id', auth, async (req) => {
    const v = getVideo(req.user!.id, (req.params as { id: string }).id);
    return { ...videoDto(v), wrappedKey: v.wrapped_key, noncePrefix: v.nonce_prefix };
  });

  app.get('/api/gallery/videos/:id/chunks/:n', auth, async (req, reply) => {
    const { id, n } = req.params as { id: string; n: string };
    const v = getVideo(req.user!.id, checkVideoId(id));
    const i = Number(n);
    if (!Number.isInteger(i) || i < 0 || i >= v.chunks) throw new NotFoundError('Morceau introuvable.');
    const file = chunkFile(v.user_id, v.id, i);
    if (!fs.existsSync(file)) throw new NotFoundError('Morceau introuvable.');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.type('application/octet-stream').send(fs.readFileSync(file));
  });

  app.delete('/api/gallery/videos/:id', auth, async (req) => {
    deleteVideo(req.user!.id, (req.params as { id: string }).id);
    return { ok: true };
  });
}
