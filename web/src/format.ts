// Mise en forme des dates, durées et jours (fr-FR).
import type { WeekDays } from './types';

export const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
export const DAY_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

export const ALL_DAYS: WeekDays = [true, true, true, true, true, true, true];
export const WEEKDAYS: WeekDays = [true, true, true, true, true, false, false];

export function normalizeDays(days: unknown): WeekDays {
  const arr = Array.isArray(days) ? days : [];
  return Array.from({ length: 7 }, (_, i) => Boolean(arr[i])) as WeekDays;
}

export function countDays(days: WeekDays): number {
  return days.filter(Boolean).length;
}

/** « Tous les jours », « Lun → Ven », « Sam · Dim », « Lun · Mer · Ven »… */
export function daysLabel(days: WeekDays): string {
  const n = countDays(days);
  if (n === 7) return 'Tous les jours';
  if (n === 0) return 'Aucun jour';
  if (n === 2 && days[5] && days[6]) return 'Le week-end';
  // Plage contiguë d'au moins 3 jours (sans boucler sur la semaine)
  const first = days.indexOf(true);
  const last = days.lastIndexOf(true);
  if (n >= 3 && last - first + 1 === n) return `${DAY_SHORT[first]} → ${DAY_SHORT[last]}`;
  return days
    .map((on, i) => (on ? DAY_SHORT[i] : null))
    .filter(Boolean)
    .join(' · ');
}

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 07:42 */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
}

/** « Samedi 17 octobre · 07:42 » */
export function formatLongDate(d: Date): string {
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} · ${formatTime(d)}`;
}

/** « 17 oct. 2026 à 07:42 » */
export function formatDateTime(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${date} à ${formatTime(d)}`;
}

/** Heure si aujourd'hui, sinon « hier 23:58 » ou « 12 oct. 07:30 ». */
export function formatEventTime(value: string | null | undefined, now = new Date()): string {
  const d = toDate(value);
  if (!d) return '—';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `hier ${formatTime(d)}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${formatTime(d)}`;
}

/** « il y a 12 s », « il y a 3 min », « il y a 2 h », « il y a 4 jours » */
export function formatAgo(value: string | number | Date | null | undefined, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return 'jamais';
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  const months = Math.round(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.round(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

/** « 9 jours », « 1 jour » */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${Math.abs(n) >= 2 ? pluralForm : singular}`;
}

/** 1 284 (espace fine insécable) */
export function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR');
}

export function secondsLabel(s: number): string {
  if (s < 60) return `${s} s`;
  const m = s / 60;
  return Number.isInteger(m) ? `${m} min` : `${s} s`;
}

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return Number.isInteger(h) ? `${h} h` : `${m} min`;
}

/** Résumé lisible d'un user-agent : « Firefox · Linux ». */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Navigateur inconnu';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|node|undici/i.test(ua)
              ? 'Script'
              : 'Navigateur';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return os ? `${browser} · ${os}` : browser;
}

export function isValidTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
