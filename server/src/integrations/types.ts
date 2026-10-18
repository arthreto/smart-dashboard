import type { DB } from '../db.js';
import type { EventLevel } from '../events.js';

export type IntegrationId = 'spotify' | 'roblox' | 'pathe' | 'icloud' | 'weather';
export type IntegrationStatus = 'ok' | 'warning' | 'error' | 'disabled';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'readonly' | 'number' | 'select' | 'time-list' | 'chips';
  mono?: boolean;
  copyable?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface ActionDef {
  id: string;
  label: string;
}

export interface IntegrationContext {
  db: DB;
  /** Foyer concerné (0 hors foyer, dans certains tests). */
  householdId: number;
  /** Identifiants d'application fournis par l'administrateur (ex. app Spotify). */
  app: Record<string, string>;
  config: Record<string, any>;
  secrets: Record<string, string>;
  saveConfig(patch: Record<string, unknown>): void;
  saveSecrets(patch: Record<string, string | null>): void;
  log(level: EventLevel, message: string): void;
}

export interface RunResult {
  status: 'ok' | 'warning' | 'error';
  detail: string;
}

export interface IntegrationDef {
  id: IntegrationId;
  name: string;
  description: string;
  defaults: Record<string, unknown>;
  /** Secrets éditables depuis la console (les autres, comme les jetons OAuth, restent internes). */
  secretFields: string[];
  fields(ctx: IntegrationContext): FieldDef[];
  actions?(ctx: IntegrationContext): ActionDef[];
  /** Message expliquant ce qui manque, ou null si l'intégration est prête. */
  missing(ctx: IntegrationContext): string | null;
  /** L'intégration doit-elle être relancée maintenant ? */
  isDue(ctx: IntegrationContext, lastRunAt: Date | null, now: Date): boolean;
  run(ctx: IntegrationContext): Promise<RunResult>;
  test(ctx: IntegrationContext): Promise<string>;
  sanitizeConfig(patch: Record<string, unknown>, current: Record<string, any>): Record<string, unknown>;
  /** Valeurs calculées affichées en lecture seule (URI de redirection, compte connecté…). */
  computed?(ctx: IntegrationContext): Record<string, unknown>;
}

export class ConfigError extends Error {}

export function str(value: unknown, max = 200): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new ConfigError('Valeur invalide.');
  return String(value).trim().slice(0, max);
}

export function num(value: unknown, min: number, max: number, label: string): number {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ConfigError(`${label} doit être compris entre ${min} et ${max}.`);
  return n;
}
