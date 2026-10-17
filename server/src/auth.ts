import * as OTPAuth from 'otpauth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db.js';
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword } from './crypto.js';

export const SESSION_COOKIE = 'sd_session';
const SESSION_DAYS = 30;

export interface SessionRow {
  id: string;
  token_hash: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

interface AdminRow {
  password_hash: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionRow;
    deviceAuthed?: boolean;
  }
}

export function getAdmin(db: DB): AdminRow | undefined {
  return db.prepare('SELECT password_hash, totp_secret_enc, totp_pending_enc, totp_enabled FROM admin WHERE id = 1').get() as
    | AdminRow
    | undefined;
}

export function hasAdmin(db: DB): boolean {
  return !!getAdmin(db);
}

export function createAdmin(db: DB, password: string): void {
  db.prepare('INSERT INTO admin (id, password_hash, created_at) VALUES (1, ?, ?)').run(hashPassword(password), new Date().toISOString());
}

export function setPassword(db: DB, password: string): void {
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(hashPassword(password));
}

export function checkPassword(db: DB, password: string): boolean {
  const admin = getAdmin(db);
  if (!admin || typeof password !== 'string') return false;
  return verifyPassword(password, admin.password_hash);
}

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit faire au moins 10 caractères.';
  if (password.length > 200) return 'Mot de passe trop long.';
  return null;
}

// ---------------------------------------------------------------- sessions

export function createSession(db: DB, userAgent: string): string {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.prepare(
    'INSERT INTO sessions (id, token_hash, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(randomToken(9), sha256(token), userAgent.slice(0, 200), now.toISOString(), now.toISOString(), expires.toISOString());
  return token;
}

export function findSession(db: DB, token: string | undefined): SessionRow | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token)) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }
  // Session glissante, mise à jour au plus une fois par minute.
  if (now - new Date(row.last_seen_at).getTime() > 60_000) {
    const nowIso = new Date(now).toISOString();
    const expires = new Date(now + SESSION_DAYS * 86400000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(nowIso, expires, row.id);
    row.last_seen_at = nowIso;
  }
  return row;
}

export function deleteSessionByToken(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function purgeExpiredSessions(db: DB): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

export function sessionCookieOptions(production: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: production,
    maxAge: SESSION_DAYS * 86400,
  };
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session) {
    await reply.code(401).send({ error: 'unauthenticated', message: 'Connecte-toi pour continuer.' });
  }
}

// ---------------------------------------------------------------- TOTP (2FA)

function totpFor(secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: 'Smart Dashboard',
    label: 'Console',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function totpEnabled(db: DB): boolean {
  return !!getAdmin(db)?.totp_enabled;
}

export function beginTotpSetup(db: DB): { secret: string; otpauthUrl: string } {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  db.prepare('UPDATE admin SET totp_pending_enc = ? WHERE id = 1').run(encrypt(secret));
  return { secret, otpauthUrl: totpFor(secret).toString() };
}

export function confirmTotpSetup(db: DB, code: string): boolean {
  const admin = getAdmin(db);
  if (!admin?.totp_pending_enc) return false;
  const secret = decrypt(admin.totp_pending_enc);
  if (totpFor(secret).validate({ token: String(code ?? '').replace(/\s/g, ''), window: 1 }) === null) return false;
  db.prepare('UPDATE admin SET totp_secret_enc = ?, totp_pending_enc = NULL, totp_enabled = 1 WHERE id = 1').run(encrypt(secret));
  return true;
}

export function checkTotp(db: DB, code: unknown): boolean {
  const admin = getAdmin(db);
  if (!admin?.totp_enabled || !admin.totp_secret_enc) return true;
  if (typeof code !== 'string' && typeof code !== 'number') return false;
  return totpFor(decrypt(admin.totp_secret_enc)).validate({ token: String(code).replace(/\s/g, ''), window: 1 }) !== null;
}

export function disableTotp(db: DB): void {
  db.prepare('UPDATE admin SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled = 0 WHERE id = 1').run();
}
