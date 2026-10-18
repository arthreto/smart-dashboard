import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { config } from '../config.js';
import {
  AuthError,
  SESSION_COOKIE,
  beginTotpSetup,
  checkPassword,
  checkTotp,
  confirmTotpSetup,
  createSession,
  createUserWithHousehold,
  deleteSessionByToken,
  deleteUserSessions,
  disableTotp,
  dummyPasswordCheck,
  findInvite,
  findUserByLogin,
  getUser,
  hasAdmin,
  markInviteUsed,
  publicUser,
  requireSession,
  sessionCookieOptions,
  setPassword,
  validateLogin,
  validatePasswordStrength,
} from '../auth.js';
import { createFirstAdmin } from '../bootstrap.js';
import { logEvent } from '../events.js';
import { renameHousehold } from '../households.js';

type Body = Record<string, unknown>;

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function authRoutes(app: FastifyInstance, db: DB): void {
  const loginLimit = { rateLimit: { max: 10, timeWindow: '10 minutes' } };
  const auth = { preHandler: requireSession };

  app.get('/api/auth/status', async (req) => ({
    setupRequired: !hasAdmin(db),
    authenticated: !!req.user,
    user: req.user ? publicUser(db, req.user) : null,
  }));

  // Premier compte (administrateur). En production il se crée depuis le serveur
  // (deploy/install.sh → cli.js ensure-admin) : personne ne peut « réclamer » une console
  // fraîchement installée depuis Internet.
  app.post('/api/auth/setup', { config: loginLimit }, async (req, reply) => {
    if (hasAdmin(db)) return reply.code(409).send({ error: 'already_setup', message: 'Le compte administrateur existe déjà.' });
    if (config.production && !isLoopback(req.ip) && process.env.ALLOW_WEB_SETUP !== 'true') {
      return reply.code(403).send({
        error: 'setup_on_server',
        message: 'Crée le compte depuis le serveur : cd /opt/smart-dashboard/server && sudo -u smartdash node dist/cli.js ensure-admin',
      });
    }
    const { login, password, name } = (req.body ?? {}) as Body;
    try {
      const user = createFirstAdmin(db, String(login ?? ''), String(password ?? ''), typeof name === 'string' ? name : '');
      logEvent(db, 'console', 'success', `Compte administrateur « ${user.login} » créé`);
      const token = createSession(db, user.id, req.headers['user-agent'] ?? '');
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config.production));
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });

  app.post('/api/auth/login', { config: loginLimit }, async (req, reply) => {
    const { login, password, totp } = (req.body ?? {}) as Body;
    const user = typeof login === 'string' && login.trim() ? findUserByLogin(db, login) : undefined;
    if (!user) dummyPasswordCheck(password);
    if (!user || !checkPassword(user, password)) {
      logEvent(db, 'console', 'warning', `Échec de connexion${typeof login === 'string' ? ` pour « ${login.slice(0, 60)} »` : ''} (${req.ip})`);
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Identifiant ou mot de passe incorrect.' });
    }
    if (user.disabled) return reply.code(403).send({ error: 'disabled', message: 'Ce compte a été désactivé par l’administrateur.' });
    if (user.totp_enabled) {
      if (totp === undefined || totp === null || totp === '') {
        return reply.code(401).send({ error: 'totp_required', message: 'Saisis le code de ton application d’authentification.' });
      }
      if (!checkTotp(user, totp)) return reply.code(401).send({ error: 'invalid_totp', message: 'Code de vérification incorrect.' });
    }
    const token = createSession(db, user.id, req.headers['user-agent'] ?? '');
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config.production));
    logEvent(db, 'console', 'info', `Connexion de « ${user.login} »`);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSessionByToken(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ------------------------------------------------------------ invitations et réinitialisations
  app.get('/api/invites/:token', { config: loginLimit }, async (req) => {
    const inv = findInvite(db, (req.params as { token: string }).token);
    if (!inv) return { valid: false };
    const user = inv.user_id ? getUser(db, inv.user_id) : undefined;
    return { valid: true, kind: inv.kind, expiresAt: inv.expires_at, note: inv.note, login: user?.login ?? null };
  });

  app.post('/api/invites/:token/accept', { config: loginLimit }, async (req, reply) => {
    const inv = findInvite(db, (req.params as { token: string }).token);
    if (!inv) return reply.code(410).send({ error: 'invite_invalid', message: 'Ce lien n’est plus valable : demande-en un nouveau à l’administrateur.' });
    const { login, name, password, householdName } = (req.body ?? {}) as Body;
    try {
      let userId: number;
      if (inv.kind === 'reset') {
        const err = validatePasswordStrength(password);
        if (err) throw new AuthError(err);
        const user = getUser(db, inv.user_id!);
        if (!user) throw new AuthError('Compte introuvable.');
        setPassword(db, user.id, password as string);
        disableTotp(db, user.id);
        deleteUserSessions(db, user.id);
        userId = user.id;
        logEvent(db, 'console', 'warning', `Mot de passe de « ${user.login} » réinitialisé par lien`);
      } else {
        const user = createUserWithHousehold(db, {
          login: String(login ?? ''),
          name: typeof name === 'string' ? name : '',
          password: String(password ?? ''),
          householdName: typeof householdName === 'string' ? householdName : '',
        });
        userId = user.id;
        logEvent(db, 'console', 'success', `Nouveau compte « ${user.login} » créé par invitation`);
      }
      markInviteUsed(db, inv.id, userId);
      const token = createSession(db, userId, req.headers['user-agent'] ?? '');
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config.production));
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });

  // ------------------------------------------------------------ mon compte
  app.patch('/api/auth/profile', auth, async (req, reply) => {
    const { login, name, householdName } = (req.body ?? {}) as Body;
    const user = req.user!;
    if (login !== undefined && login !== user.login) {
      const err = validateLogin(login);
      if (err) return reply.code(400).send({ error: 'invalid', message: err });
      const other = findUserByLogin(db, login as string);
      if (other && other.id !== user.id) return reply.code(400).send({ error: 'invalid', message: 'Cet identifiant est déjà utilisé.' });
      db.prepare('UPDATE users SET login = ? WHERE id = ?').run((login as string).trim(), user.id);
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length > 60) return reply.code(400).send({ error: 'invalid', message: 'Nom trop long (60 caractères max).' });
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), user.id);
    }
    if (householdName !== undefined) {
      if (typeof householdName !== 'string' || !householdName.trim() || householdName.length > 60) {
        return reply.code(400).send({ error: 'invalid', message: 'Le nom du foyer doit faire entre 1 et 60 caractères.' });
      }
      renameHousehold(user.household_id, householdName);
    }
    return publicUser(db, getUser(db, user.id)!);
  });

  app.post('/api/auth/password', { ...auth, config: loginLimit }, async (req, reply) => {
    const { current, next } = (req.body ?? {}) as Body;
    if (!checkPassword(req.user, current)) {
      return reply.code(400).send({ error: 'invalid_credentials', message: 'Mot de passe actuel incorrect.' });
    }
    const err = validatePasswordStrength(next);
    if (err) return reply.code(400).send({ error: 'weak_password', message: err });
    setPassword(db, req.user!.id, next as string);
    deleteUserSessions(db, req.user!.id, req.session!.id);
    logEvent(db, 'console', 'warning', `Mot de passe de « ${req.user!.login} » modifié`);
    return { ok: true };
  });

  app.post('/api/auth/totp/setup', auth, async (req) => {
    const { secret, otpauthUrl } = beginTotpSetup(db, req.user!);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, color: { dark: '#0B0B0E', light: '#FFFFFF' } });
    return { secret, otpauthUrl, qrDataUrl };
  });

  app.post('/api/auth/totp/enable', { ...auth, config: loginLimit }, async (req, reply) => {
    const { code } = (req.body ?? {}) as Body;
    if (!confirmTotpSetup(db, req.user!.id, String(code ?? ''))) return reply.code(400).send({ error: 'invalid_totp', message: 'Code incorrect, réessaie.' });
    logEvent(db, 'console', 'success', `Double authentification activée pour « ${req.user!.login} »`);
    return { ok: true };
  });

  app.post('/api/auth/totp/disable', { ...auth, config: loginLimit }, async (req, reply) => {
    const { code } = (req.body ?? {}) as Body;
    const user = req.user!;
    if (!user.totp_enabled || !checkTotp(user, code)) return reply.code(400).send({ error: 'invalid_totp', message: 'Code incorrect.' });
    disableTotp(db, user.id);
    logEvent(db, 'console', 'warning', `Double authentification désactivée pour « ${user.login} »`);
    return { ok: true };
  });

  app.get('/api/auth/sessions', auth, async (req) => {
    const rows = db
      .prepare('SELECT id, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
      .all(req.user!.id) as { id: string; user_agent: string; created_at: string; last_seen_at: string }[];
    return rows.map((r) => ({ id: r.id, userAgent: r.user_agent, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === req.session!.id }));
  });

  app.delete('/api/auth/sessions/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.session!.id) return reply.code(400).send({ error: 'current_session', message: 'Utilise « Se déconnecter » pour la session actuelle.' });
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, req.user!.id);
    return { ok: true };
  });
}
