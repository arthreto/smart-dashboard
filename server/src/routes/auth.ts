import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { config } from '../config.js';
import {
  SESSION_COOKIE,
  beginTotpSetup,
  checkPassword,
  checkTotp,
  confirmTotpSetup,
  createAdmin,
  createSession,
  deleteSessionByToken,
  disableTotp,
  hasAdmin,
  requireSession,
  sessionCookieOptions,
  setPassword,
  totpEnabled,
  validatePasswordStrength,
} from '../auth.js';
import { logEvent } from '../events.js';
import { seedDefaults } from '../seed.js';

type Body = Record<string, unknown>;

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function authRoutes(app: FastifyInstance, db: DB): void {
  const loginLimit = { rateLimit: { max: 10, timeWindow: '10 minutes' } };

  app.get('/api/auth/status', async (req) => ({
    setupRequired: !hasAdmin(db),
    authenticated: !!req.session,
    totpEnabled: totpEnabled(db),
  }));

  app.post('/api/auth/setup', { config: loginLimit }, async (req, reply) => {
    if (hasAdmin(db)) return reply.code(409).send({ error: 'already_setup', message: 'Le compte existe déjà.' });
    // En production, le compte se crée sur le serveur (deploy/install.sh) : personne ne peut
    // « réclamer » une console fraîchement installée depuis Internet.
    if (config.production && !isLoopback(req.ip) && process.env.ALLOW_WEB_SETUP !== 'true') {
      return reply.code(403).send({
        error: 'setup_on_server',
        message: 'Crée le compte depuis le serveur : cd /opt/smart-dashboard/server && sudo -u smartdash node dist/cli.js ensure-admin',
      });
    }
    const { password } = (req.body ?? {}) as Body;
    const err = validatePasswordStrength(password);
    if (err) return reply.code(400).send({ error: 'weak_password', message: err });
    createAdmin(db, password as string);
    seedDefaults(db);
    logEvent(db, 'console', 'success', 'Compte de la console créé');
    const token = createSession(db, req.headers['user-agent'] ?? '');
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config.production));
    return { ok: true };
  });

  app.post('/api/auth/login', { config: loginLimit }, async (req, reply) => {
    const { password, totp } = (req.body ?? {}) as Body;
    if (!hasAdmin(db) || typeof password !== 'string' || !checkPassword(db, password)) {
      logEvent(db, 'console', 'warning', `Échec de connexion à la console (${req.ip})`);
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Mot de passe incorrect.' });
    }
    if (totpEnabled(db)) {
      if (totp === undefined || totp === null || totp === '') {
        return reply.code(401).send({ error: 'totp_required', message: 'Saisis le code de ton application d’authentification.' });
      }
      if (!checkTotp(db, totp)) return reply.code(401).send({ error: 'invalid_totp', message: 'Code de vérification incorrect.' });
    }
    const token = createSession(db, req.headers['user-agent'] ?? '');
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config.production));
    logEvent(db, 'console', 'info', 'Connexion à la console');
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSessionByToken(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', { preHandler: requireSession, config: loginLimit }, async (req, reply) => {
    const { current, next } = (req.body ?? {}) as Body;
    if (typeof current !== 'string' || !checkPassword(db, current)) {
      return reply.code(400).send({ error: 'invalid_credentials', message: 'Mot de passe actuel incorrect.' });
    }
    const err = validatePasswordStrength(next);
    if (err) return reply.code(400).send({ error: 'weak_password', message: err });
    setPassword(db, next as string);
    // Déconnecte les autres sessions.
    db.prepare('DELETE FROM sessions WHERE id != ?').run(req.session!.id);
    logEvent(db, 'console', 'warning', 'Mot de passe de la console modifié');
    return { ok: true };
  });

  app.post('/api/auth/totp/setup', { preHandler: requireSession }, async () => {
    const { secret, otpauthUrl } = beginTotpSetup(db);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, color: { dark: '#0B0B0E', light: '#FFFFFF' } });
    return { secret, otpauthUrl, qrDataUrl };
  });

  app.post('/api/auth/totp/enable', { preHandler: requireSession, config: loginLimit }, async (req, reply) => {
    const { code } = (req.body ?? {}) as Body;
    if (!confirmTotpSetup(db, String(code ?? ''))) return reply.code(400).send({ error: 'invalid_totp', message: 'Code incorrect, réessaie.' });
    logEvent(db, 'console', 'success', 'Double authentification activée');
    return { ok: true };
  });

  app.post('/api/auth/totp/disable', { preHandler: requireSession, config: loginLimit }, async (req, reply) => {
    const { code } = (req.body ?? {}) as Body;
    if (!totpEnabled(db) || !checkTotp(db, code)) return reply.code(400).send({ error: 'invalid_totp', message: 'Code incorrect.' });
    disableTotp(db);
    logEvent(db, 'console', 'warning', 'Double authentification désactivée');
    return { ok: true };
  });

  app.get('/api/auth/sessions', { preHandler: requireSession }, async (req) => {
    const rows = db.prepare('SELECT id, user_agent, created_at, last_seen_at FROM sessions ORDER BY last_seen_at DESC').all() as {
      id: string;
      user_agent: string;
      created_at: string;
      last_seen_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, userAgent: r.user_agent, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === req.session!.id }));
  });

  app.delete('/api/auth/sessions/:id', { preHandler: requireSession }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.session!.id) return reply.code(400).send({ error: 'current_session', message: 'Utilise « Se déconnecter » pour la session actuelle.' });
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return { ok: true };
  });
}
