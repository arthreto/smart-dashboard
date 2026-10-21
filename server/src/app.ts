import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { DB } from './db.js';
import { config } from './config.js';
import { AuthError, SESSION_COOKIE, findSession } from './auth.js';
import { ValidationError } from './habits.js';
import { ConfigError } from './integrations/types.js';
import { HttpError, NotFoundError } from './http.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { householdRoutes } from './routes/household.js';
import { deviceRoutes } from './routes/device.js';
import { galleryRoutes } from './routes/gallery.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Adresse sans les jetons qu'elle peut contenir (liens d'invitation, retour OAuth) : pour les journaux. */
export function safeUrl(url: string): string {
  return url.replace(/^(\/api\/invites\/)[^/?]+/, '$1…').replace(/\?.*$/, (q) => (q.length > 1 ? '?…' : ''));
}

/**
 * Clé des limites de tentatives : l'adresse IPv4, ou le préfixe /64 d'une adresse IPv6
 * (un seul abonné dispose souvent de milliards d'adresses dans son /64).
 */
export function rateLimitKey(ip: string): string {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => x.toLowerCase()).join(':')}::/64`;
}

/** `db` est la base principale (comptes, foyers, écrans) ; voir households.ts pour les foyers. */
export async function buildApp(db: DB, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            serializers: {
              req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: safeUrl(req.url), remoteAddress: req.ip }),
            },
          },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false, keyGenerator: (req) => rateLimitKey(req.ip) });

  // Corps binaires (capture d'écran de la tablette).
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // Session de la console (cookie) disponible sur toutes les requêtes.
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    const found = token ? findSession(db, token) : null;
    if (found) {
      req.session = found.session;
      req.user = found.user;
    }
  });

  // Protection CSRF : en-tête personnalisé obligatoire pour les modifications depuis la console.
  app.addHook('preHandler', async (req, reply) => {
    if (!MUTATING.has(req.method)) return;
    const url = req.url;
    if (!url.startsWith('/api/') || url.startsWith('/api/v1/')) return;
    if (req.headers['x-requested-with'] !== 'smart-dashboard') {
      await reply.code(403).send({ error: 'csrf', message: 'Requête refusée (en-tête manquant).' });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (config.production) reply.header('Strict-Transport-Security', 'max-age=15552000');
    if (!req.url.startsWith('/api/')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ValidationError || err instanceof ConfigError || err instanceof AuthError) {
      return reply.code(400).send({ error: 'invalid', message: err.message });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof HttpError) {
      const code = err.status === 409 || err.status === 400 ? err.status : 502;
      return reply.code(code).send({ error: 'upstream', message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Trop de tentatives, réessaie dans quelques minutes.' });
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Erreur interne du serveur.' });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  authRoutes(app, db);
  householdRoutes(app, db);
  adminRoutes(app, db);
  deviceRoutes(app, db);
  galleryRoutes(app, db);

  // Console web compilée (web/dist), servie par le même serveur.
  const hasWeb = fs.existsSync(path.join(config.webDir, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDir, prefix: '/', wildcard: false, index: ['index.html'] });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && hasWeb) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Route introuvable.' });
  });

  return app;
}
