// Comptes de la console (un compte par foyer, plus le rôle administrateur), sessions,
// double authentification et liens d'invitation / de réinitialisation.
import * as OTPAuth from 'otpauth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db.js';
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword, verifyPasswordAsync } from './crypto.js';
import { createHousehold, household } from './households.js';

export const SESSION_COOKIE = 'sd_session';
const SESSION_DAYS = 30;

export type Role = 'admin' | 'user';

export interface UserRow {
  id: number;
  login: string;
  name: string;
  role: Role;
  household_id: number;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled: number;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: number;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionRow;
    user?: UserRow;
    /** Base du foyer de la requête (compte connecté ou écran authentifié). */
    hdb?: DB;
  }
}

export class AuthError extends Error {}

// ---------------------------------------------------------------- comptes

export function getUser(db: DB, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByLogin(db: DB, login: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE login = ? COLLATE NOCASE').get(login.trim()) as UserRow | undefined;
}

export function hasAdmin(db: DB): boolean {
  return !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
}

export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit faire au moins 10 caractères.';
  if (password.length > 200) return 'Mot de passe trop long.';
  return null;
}

/** Identifiant de connexion : une adresse e-mail ou un nom simple (lettres, chiffres, . _ -). */
export function validateLogin(login: unknown): string | null {
  if (typeof login !== 'string') return 'Identifiant manquant.';
  const v = login.trim();
  if (v.length < 3 || v.length > 120) return 'L’identifiant doit faire entre 3 et 120 caractères.';
  if (!/^[A-Za-z0-9._%+-]+(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?$/.test(v)) return 'Identifiant invalide : une adresse e-mail ou des lettres, chiffres, « . », « _ » et « - ».';
  return null;
}

export interface NewUser {
  login: string;
  name?: string;
  password: string;
  role?: Role;
  householdName?: string;
}

/** Crée un compte avec son propre foyer (et les données d'exemple du foyer). */
export function createUserWithHousehold(db: DB, input: NewUser): UserRow {
  const loginErr = validateLogin(input.login);
  if (loginErr) throw new AuthError(loginErr);
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) throw new AuthError(pwErr);
  if (findUserByLogin(db, input.login)) throw new AuthError('Cet identifiant est déjà utilisé.');
  const name = (input.name ?? '').trim().slice(0, 60);
  const householdId = createHousehold(input.householdName?.trim() || (name ? `Foyer de ${name}` : 'Mon foyer'));
  const res = db
    .prepare('INSERT INTO users (login, name, role, household_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.login.trim(), name, input.role ?? 'user', householdId, hashPassword(input.password), new Date().toISOString());
  return getUser(db, Number(res.lastInsertRowid))!;
}

export function setPassword(db: DB, userId: number, password: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

export function checkPassword(user: UserRow | undefined, password: unknown): boolean {
  if (!user || typeof password !== 'string') return false;
  return verifyPassword(password, user.password_hash);
}

// Comparaison factice quand l'identifiant n'existe pas : même durée de réponse qu'un
// mauvais mot de passe (on ne révèle pas quels identifiants existent).
const DUMMY_HASH = hashPassword(randomToken(16));
export function dummyPasswordCheck(password: unknown): void {
  verifyPassword(typeof password === 'string' ? password : '', DUMMY_HASH);
}

/** Connexion : vérification asynchrone, pour ne pas bloquer les autres foyers pendant le calcul. */
export async function checkPasswordAsync(user: UserRow | undefined, password: unknown): Promise<boolean> {
  const pw = typeof password === 'string' ? password : '';
  if (!user || typeof password !== 'string') {
    await verifyPasswordAsync(pw, DUMMY_HASH);
    return false;
  }
  return verifyPasswordAsync(pw, user.password_hash);
}

export function publicUser(db: DB, u: UserRow) {
  const h = db.prepare('SELECT id, name FROM households WHERE id = ?').get(u.household_id) as { id: number; name: string } | undefined;
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    role: u.role,
    totpEnabled: !!u.totp_enabled,
    household: h ?? { id: u.household_id, name: '' },
  };
}

// ---------------------------------------------------------------- sessions

export function createSession(db: DB, userId: number, userAgent: string): string {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.prepare(
    'INSERT INTO sessions (id, token_hash, user_id, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(randomToken(9), sha256(token), userId, userAgent.slice(0, 200), now.toISOString(), now.toISOString(), expires.toISOString());
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), userId);
  return token;
}

/** Session valide et son compte (compte désactivé = session refusée). */
export function findSession(db: DB, token: string | undefined): { session: SessionRow; user: UserRow } | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token)) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }
  const user = getUser(db, row.user_id);
  if (!user || user.disabled) return null;
  // Session glissante, mise à jour au plus une fois par minute.
  if (now - new Date(row.last_seen_at).getTime() > 60_000) {
    const nowIso = new Date(now).toISOString();
    const expires = new Date(now + SESSION_DAYS * 86400000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(nowIso, expires, row.id);
    row.last_seen_at = nowIso;
  }
  return { session: row, user };
}

export function deleteSessionByToken(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteUserSessions(db: DB, userId: number, exceptSessionId?: string): void {
  if (exceptSessionId) db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db: DB): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('DELETE FROM pairing_codes WHERE expires_at < ?').run(new Date().toISOString());
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
  if (!req.session || !req.user) {
    await reply.code(401).send({ error: 'unauthenticated', message: 'Connecte-toi pour continuer.' });
    return;
  }
  req.hdb = household(req.user.household_id);
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session || !req.user) {
    await reply.code(401).send({ error: 'unauthenticated', message: 'Connecte-toi pour continuer.' });
    return;
  }
  if (req.user.role !== 'admin') await reply.code(403).send({ error: 'forbidden', message: 'Réservé à l’administrateur.' });
}

// ---------------------------------------------------------------- TOTP (2FA)

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: 'Smart Dashboard',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function beginTotpSetup(db: DB, user: UserRow): { secret: string; otpauthUrl: string } {
  // Déjà active : il faut d'abord la désactiver (avec un code), sinon une session volée
  // suffirait à remplacer l'application d'authentification.
  if (user.totp_enabled) throw new AuthError('La double authentification est déjà active : désactive-la d’abord avec un code.');
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  db.prepare('UPDATE users SET totp_pending_enc = ? WHERE id = ?').run(encrypt(secret), user.id);
  return { secret, otpauthUrl: totpFor(secret, user.login).toString() };
}

export function confirmTotpSetup(db: DB, userId: number, code: string): boolean {
  const user = getUser(db, userId);
  if (!user?.totp_pending_enc) return false;
  const secret = decrypt(user.totp_pending_enc);
  if (totpFor(secret, user.login).validate({ token: String(code ?? '').replace(/\s/g, ''), window: 1 }) === null) return false;
  db.prepare('UPDATE users SET totp_secret_enc = ?, totp_pending_enc = NULL, totp_enabled = 1 WHERE id = ?').run(encrypt(secret), userId);
  return true;
}

export function checkTotp(user: UserRow, code: unknown): boolean {
  if (!user.totp_enabled || !user.totp_secret_enc) return true;
  if (typeof code !== 'string' && typeof code !== 'number') return false;
  return totpFor(decrypt(user.totp_secret_enc), user.login).validate({ token: String(code).replace(/\s/g, ''), window: 1 }) !== null;
}

export function disableTotp(db: DB, userId: number): void {
  db.prepare('UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled = 0 WHERE id = ?').run(userId);
}

// ---------------------------------------------------------------- invitations

export interface InviteRow {
  id: number;
  kind: 'invite' | 'reset';
  token_hash: string;
  note: string;
  user_id: number | null;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: number | null;
}

/** Lien à usage unique ; seul son condensé est conservé. */
export function createInvite(db: DB, opts: { kind: 'invite' | 'reset'; createdBy: number | null; userId?: number; note?: string; days?: number }): { token: string; expiresAt: string; id: number } {
  const token = randomToken(24);
  const days = Math.max(1, Math.min(30, Math.round(opts.days ?? (opts.kind === 'reset' ? 2 : 7))));
  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
  if (opts.kind === 'reset') db.prepare("DELETE FROM invites WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL").run(opts.userId);
  const res = db
    .prepare('INSERT INTO invites (kind, token_hash, note, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(opts.kind, sha256(token), (opts.note ?? '').trim().slice(0, 80), opts.kind === 'reset' ? opts.userId : null, opts.createdBy, new Date().toISOString(), expiresAt);
  return { token, expiresAt, id: Number(res.lastInsertRowid) };
}

export function findInvite(db: DB, token: unknown): InviteRow | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(token)) as InviteRow | undefined;
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function markInviteUsed(db: DB, id: number, userId: number): void {
  db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?').run(new Date().toISOString(), userId, id);
}
