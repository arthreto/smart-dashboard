// Réglages globaux des services, gérés par l'administrateur : services proposés aux
// foyers et identifiants d'application partagés (l'app Spotify du serveur, par exemple).
// Chaque foyer connecte ensuite son propre compte (OAuth Spotify, iCloud…).
import type { DB } from './db.js';
import { getGlobal, setGlobal } from './db.js';
import { decryptJson, encryptJson, previewSecret } from './crypto.js';
import { config } from './config.js';
import { ConfigError, str } from './integrations/types.js';
import { logEvent } from './events.js';

export type ServiceId = 'spotify' | 'roblox' | 'pathe' | 'icloud' | 'weather';
export const SERVICE_IDS: ServiceId[] = ['spotify', 'roblox', 'pathe', 'icloud', 'weather'];

interface AppField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'readonly';
  mono?: boolean;
  copyable?: boolean;
  placeholder?: string;
}

interface ServiceInfo {
  name: string;
  description: string;
  /** Ce que l'administrateur doit fournir (vide = rien à configurer). */
  appFields: AppField[];
  secretFields: string[];
  help: string;
}

export function spotifyRedirectUri(): string {
  return `${config.publicUrl}/api/oauth/spotify/callback`;
}

const INFO: Record<ServiceId, ServiceInfo> = {
  spotify: {
    name: 'Spotify',
    description: 'Application Spotify du serveur : chaque foyer y connecte son propre compte.',
    appFields: [
      { key: 'clientId', label: 'Client ID', type: 'text', mono: true, copyable: true, placeholder: 'Depuis developer.spotify.com' },
      { key: 'clientSecret', label: 'Client Secret', type: 'secret' },
      { key: 'redirectUri', label: 'URI de redirection (à copier dans l’app Spotify)', type: 'readonly', mono: true, copyable: true },
    ],
    secretFields: ['clientSecret'],
    help:
      'En « Development Mode », Spotify n’autorise que les comptes ajoutés à la main (25 au maximum) : ' +
      'developer.spotify.com › ton app › Settings › User Management › ajoute l’e-mail Spotify de chaque personne.',
  },
  weather: { name: 'Météo', description: 'Open-Meteo : aucune clé nécessaire. Chaque foyer indique sa ville.', appFields: [], secretFields: [], help: '' },
  roblox: { name: 'Roblox', description: 'API publique : aucune clé nécessaire. Chaque foyer choisit son jeu.', appFields: [], secretFields: [], help: '' },
  pathe: { name: 'Pathé', description: 'Programme public de pathe.fr. Chaque foyer choisit son cinéma.', appFields: [], secretFields: [], help: '' },
  icloud: { name: 'Calendrier iCloud', description: 'CalDAV d’Apple : chaque foyer saisit son identifiant et un mot de passe pour app.', appFields: [], secretFields: [], help: '' },
};

interface StoredApp {
  config: Record<string, string>;
  secretsEnc: string | null;
}

function stored(db: DB, id: ServiceId): StoredApp {
  return getGlobal<StoredApp>(db, `app:${id}`, { config: {}, secretsEnc: null });
}

/** Identifiants d'application d'un service (déchiffrés), pour les intégrations des foyers. */
export function appCredentials(db: DB, id: string): Record<string, string> {
  if (!SERVICE_IDS.includes(id as ServiceId)) return {};
  const s = stored(db, id as ServiceId);
  return { ...s.config, ...decryptJson<Record<string, string>>(s.secretsEnc, {}) };
}

export function serviceAvailable(db: DB, id: string): boolean {
  return getGlobal<Record<string, boolean>>(db, 'services', {})[id] !== false;
}

function appMissing(id: ServiceId, app: Record<string, string>): string | null {
  if (id === 'spotify' && (!app.clientId || !app.clientSecret)) return 'Renseigne le Client ID et le Client Secret de l’app Spotify.';
  return null;
}

export function serviceDto(db: DB, id: ServiceId) {
  const info = INFO[id];
  const s = stored(db, id);
  const secrets = decryptJson<Record<string, string>>(s.secretsEnc, {});
  const app = appCredentials(db, id);
  return {
    id,
    name: info.name,
    description: info.description,
    help: info.help,
    available: serviceAvailable(db, id),
    configured: !appMissing(id, app),
    missing: appMissing(id, app),
    fields: info.appFields,
    config: { ...s.config, ...(id === 'spotify' ? { redirectUri: spotifyRedirectUri() } : {}) },
    secrets: Object.fromEntries(info.secretFields.map((k) => [k, { set: !!secrets[k], preview: previewSecret(secrets[k] ?? '') }])),
  };
}

export function listServices(db: DB) {
  return SERVICE_IDS.map((id) => serviceDto(db, id));
}

/**
 * Modifie un service. Renvoie true si l'identité de l'application a changé (Client ID) :
 * les comptes déjà connectés par les foyers ne sont alors plus valables.
 */
export function updateService(db: DB, id: ServiceId, body: { available?: unknown; config?: unknown; secrets?: unknown }): boolean {
  const info = INFO[id];
  if (!info) throw new ConfigError('Service inconnu.');
  const s = stored(db, id);
  let identityChanged = false;
  if (body.available !== undefined) {
    const map = getGlobal<Record<string, boolean>>(db, 'services', {});
    map[id] = !!body.available;
    setGlobal(db, 'services', map);
    logEvent(db, 'admin', 'info', `${info.name} ${body.available ? 'proposé aux foyers' : 'retiré des foyers'}`);
  }
  if (body.config !== undefined) {
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) throw new ConfigError('Configuration invalide.');
    for (const [k, v] of Object.entries(body.config as Record<string, unknown>)) {
      const f = info.appFields.find((x) => x.key === k && x.type === 'text');
      if (!f) throw new ConfigError(`Champ inconnu : ${k}`);
      const val = str(v, 120);
      if (k === 'clientId' && val && !/^[A-Za-z0-9]{8,64}$/.test(val)) throw new ConfigError('Client ID invalide.');
      if (k === 'clientId' && s.config[k] && s.config[k] !== val) identityChanged = true;
      s.config[k] = val;
    }
  }
  if (body.secrets !== undefined) {
    if (!body.secrets || typeof body.secrets !== 'object') throw new ConfigError('Secrets invalides.');
    const secrets = decryptJson<Record<string, string>>(s.secretsEnc, {});
    for (const [k, v] of Object.entries(body.secrets as Record<string, unknown>)) {
      if (!info.secretFields.includes(k)) throw new ConfigError(`Champ secret inconnu : ${k}`);
      if (v === null || v === '') delete secrets[k];
      else if (typeof v !== 'string' || v.length > 500) throw new ConfigError('Valeur secrète invalide.');
      else secrets[k] = v.trim();
    }
    s.secretsEnc = encryptJson(secrets);
  }
  if (body.config !== undefined || body.secrets !== undefined) {
    setGlobal(db, `app:${id}`, s);
    logEvent(db, 'admin', 'warning', `Identifiants de l’application ${info.name} modifiés`);
  }
  return identityChanged;
}

export function revealServiceSecret(db: DB, id: ServiceId, field: string): string {
  if (!INFO[id]?.secretFields.includes(field)) throw new ConfigError('Champ secret inconnu.');
  const value = decryptJson<Record<string, string>>(stored(db, id).secretsEnc, {})[field] ?? '';
  logEvent(db, 'admin', 'info', `Secret « ${field} » de ${INFO[id].name} affiché`);
  return value;
}

/** Utilisé par la migration de l'ancienne installation (identifiants Spotify du foyer → globaux). */
export function importAppCredentials(db: DB, id: ServiceId, config: Record<string, string>, secrets: Record<string, string>): void {
  setGlobal(db, `app:${id}`, { config, secretsEnc: encryptJson(secrets) } satisfies StoredApp);
}
