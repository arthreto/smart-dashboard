import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Lit un fichier .env simple (KEY=VALUE) s'il existe, sans écraser l'environnement. */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), '.env'));

const tz = process.env.TZ || 'Europe/Paris';
// Toutes les dates « locales » du serveur (habitudes, réveils, agenda) suivent ce fuseau.
process.env.TZ = tz;

function parseTrustProxy(v: string | undefined): boolean | string {
  if (v === undefined || v === '') return '127.0.0.1,::1';
  if (v === 'false') return false;
  if (v === 'true') return true;
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:8787').replace(/\/+$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data')),
  webDir: path.resolve(process.env.WEB_DIR ?? path.join(here, '..', '..', 'web', 'dist')),
  secretKey: process.env.SECRET_KEY ?? '',
  tz,
  /** Chaîne POSIX transmise à la tablette (newlib / ESP-IDF ne lit pas la base IANA). */
  tzPosix: process.env.TZ_POSIX ?? 'CET-1CEST,M3.5.0,M10.5.0/3',
  production: process.env.NODE_ENV === 'production',
  /**
   * Proxys de confiance pour X-Forwarded-For : seulement Nginx en local. (Avec `true`, n'importe
   * quel client pourrait se choisir une adresse et contourner les limites de tentatives.)
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

export type AppConfig = typeof config;
