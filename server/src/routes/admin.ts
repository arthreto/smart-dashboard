// Routes du panel administrateur : comptes et foyers, invitations, services et clés
// d'application globales, journal du serveur. Réservées au rôle « admin ».
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, createInvite, deleteUserSessions, getUser, type UserRow } from '../auth.js';
import { recentEvents, logEvent } from '../events.js';
import { ValidationError } from '../habits.js';
import { NotFoundError } from '../http.js';
import { deleteHousehold, household, listHouseholds } from '../households.js';
import { deviceOnline, listDevices, removeHouseholdDeviceFiles } from '../device.js';
import { listServices, revealServiceSecret, serviceDto, SERVICE_IDS, updateService, type ServiceId } from '../services.js';
import { makeContext } from '../integrations/index.js';
import { forgetSpotifyAccount } from '../integrations/spotify.js';

type Body = Record<string, unknown>;

function inviteUrl(token: string): string {
  return `${config.publicUrl}/invitation/${token}`;
}

function userParam(db: DB, params: unknown): UserRow {
  const id = Number((params as { id: string }).id);
  const u = Number.isInteger(id) ? getUser(db, id) : undefined;
  if (!u) throw new NotFoundError('Compte introuvable.');
  return u;
}

function serviceParam(params: unknown): ServiceId {
  const id = (params as { id: string }).id as ServiceId;
  if (!SERVICE_IDS.includes(id)) throw new NotFoundError('Service inconnu.');
  return id;
}

export function adminRoutes(app: FastifyInstance, db: DB): void {
  const admin = { preHandler: requireAdmin };

  app.get('/api/admin/overview', admin, async () => {
    const households = listHouseholds();
    const devices = households.flatMap((h) => listDevices(h.id));
    const users = (db.prepare('SELECT COUNT(*) AS n, SUM(disabled) AS d FROM users').get() as { n: number; d: number | null });
    return {
      users: users.n,
      disabledUsers: users.d ?? 0,
      households: households.length,
      devices: devices.length,
      devicesOnline: devices.filter(deviceOnline).length,
      pendingInvites: (db.prepare("SELECT COUNT(*) AS n FROM invites WHERE kind = 'invite' AND used_at IS NULL AND expires_at > ?").get(new Date().toISOString()) as { n: number }).n,
      services: listServices(db).map((s) => ({ id: s.id, name: s.name, available: s.available, configured: s.configured })),
      publicUrl: config.publicUrl,
      events: recentEvents(db, 80),
    };
  });

  // ------------------------------------------------------------ comptes et foyers
  app.get('/api/admin/users', admin, async () => {
    const rows = db
      .prepare(
        `SELECT u.id, u.login, u.name, u.role, u.disabled, u.totp_enabled, u.created_at, u.last_login_at, u.household_id, h.name AS household_name
         FROM users u JOIN households h ON h.id = u.household_id ORDER BY u.id`,
      )
      .all() as {
      id: number;
      login: string;
      name: string;
      role: string;
      disabled: number;
      totp_enabled: number;
      created_at: string;
      last_login_at: string | null;
      household_id: number;
      household_name: string;
    }[];
    return rows.map((r) => {
      const devices = listDevices(r.household_id);
      return {
        id: r.id,
        login: r.login,
        name: r.name,
        role: r.role,
        disabled: !!r.disabled,
        totpEnabled: !!r.totp_enabled,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        household: { id: r.household_id, name: r.household_name },
        devices: devices.length,
        devicesOnline: devices.filter(deviceOnline).length,
      };
    });
  });

  app.patch('/api/admin/users/:id', admin, async (req, reply) => {
    const u = userParam(db, req.params);
    const { disabled, role } = (req.body ?? {}) as Body;
    if (u.id === req.user!.id && (disabled === true || role === 'user')) {
      return reply.code(400).send({ error: 'self', message: 'Tu ne peux pas désactiver ton propre compte ni te retirer le rôle d’administrateur.' });
    }
    if (disabled !== undefined) {
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, u.id);
      if (disabled) deleteUserSessions(db, u.id);
      logEvent(db, 'admin', 'warning', `Compte « ${u.login} » ${disabled ? 'désactivé' : 'réactivé'}`);
    }
    if (role !== undefined) {
      if (role !== 'admin' && role !== 'user') throw new ValidationError('Rôle inconnu.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
      logEvent(db, 'admin', 'warning', `Compte « ${u.login} » : rôle ${role === 'admin' ? 'administrateur' : 'utilisateur'}`);
    }
    return { ok: true };
  });

  /** Supprime un compte et tout son foyer (données, écrans). */
  app.delete('/api/admin/users/:id', admin, async (req, reply) => {
    const u = userParam(db, req.params);
    if (u.id === req.user!.id) return reply.code(400).send({ error: 'self', message: 'Tu ne peux pas supprimer ton propre compte.' });
    const others = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE household_id = ? AND id != ?').get(u.household_id, u.id) as { n: number }).n;
    if (others === 0) {
      removeHouseholdDeviceFiles(u.household_id);
      deleteHousehold(u.household_id);
    } else {
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }
    logEvent(db, 'admin', 'warning', `Compte « ${u.login} » supprimé${others === 0 ? ' avec son foyer' : ''}`);
    return { ok: true };
  });

  /** Lien de réinitialisation du mot de passe (à transmettre à la personne). */
  app.post('/api/admin/users/:id/reset-link', admin, async (req) => {
    const u = userParam(db, req.params);
    const inv = createInvite(db, { kind: 'reset', createdBy: req.user!.id, userId: u.id, days: 2 });
    logEvent(db, 'admin', 'warning', `Lien de réinitialisation créé pour « ${u.login} »`);
    return { url: inviteUrl(inv.token), expiresAt: inv.expiresAt };
  });

  // ------------------------------------------------------------ invitations
  app.get('/api/admin/invites', admin, async () => {
    const rows = db
      .prepare(
        `SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, u.login AS used_login
         FROM invites i LEFT JOIN users u ON u.id = i.used_by WHERE i.kind = 'invite' ORDER BY i.id DESC LIMIT 50`,
      )
      .all() as { id: number; note: string; created_at: string; expires_at: string; used_at: string | null; used_login: string | null }[];
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      usedBy: r.used_login,
      status: r.used_at ? 'used' : new Date(r.expires_at).getTime() < now ? 'expired' : 'pending',
    }));
  });

  app.post('/api/admin/invites', admin, async (req) => {
    const { note, days } = (req.body ?? {}) as Body;
    if (note !== undefined && (typeof note !== 'string' || note.length > 80)) throw new ValidationError('Note trop longue (80 caractères max).');
    const d = days === undefined ? 7 : Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 30) throw new ValidationError('Validité entre 1 et 30 jours.');
    const inv = createInvite(db, { kind: 'invite', createdBy: req.user!.id, note: (note as string) ?? '', days: d });
    logEvent(db, 'admin', 'info', `Invitation créée${note ? ` (${note})` : ''}`);
    return { id: inv.id, url: inviteUrl(inv.token), expiresAt: inv.expiresAt };
  });

  app.delete('/api/admin/invites/:id', admin, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const ok = db.prepare("DELETE FROM invites WHERE id = ? AND kind = 'invite' AND used_at IS NULL").run(id).changes > 0;
    if (!ok) return reply.code(404).send({ error: 'not_found', message: 'Invitation introuvable ou déjà utilisée.' });
    logEvent(db, 'admin', 'info', 'Invitation annulée');
    return { ok: true };
  });

  // ------------------------------------------------------------ services et clés d'application
  app.get('/api/admin/services', admin, async () => listServices(db));

  app.put('/api/admin/services/:id', admin, async (req) => {
    const id = serviceParam(req.params);
    const identityChanged = updateService(db, id, (req.body ?? {}) as Body);
    // Nouvelle app Spotify : les comptes connectés avec l'ancienne ne fonctionnent plus.
    if (identityChanged && id === 'spotify') {
      for (const h of listHouseholds()) forgetSpotifyAccount(makeContext(household(h.id), 'spotify'));
      logEvent(db, 'admin', 'warning', 'Nouvelle app Spotify : chaque foyer doit reconnecter son compte');
    }
    return serviceDto(db, id);
  });

  app.get('/api/admin/services/:id/secret/:field', admin, async (req) => {
    const { field } = req.params as { field: string };
    return { value: revealServiceSecret(db, serviceParam(req.params), field) };
  });
}
