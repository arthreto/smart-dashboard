// Helpers de dates « locales » (fuseau process.env.TZ, fixé dans config.ts).

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Date locale à midi : évite les surprises des changements d'heure. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayIndex(key: string): number {
  return (parseDateKey(key).getDay() + 6) % 7;
}

export function mondayOf(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

/** Semaine ISO (année + numéro), utilisée pour les jokers de série. */
export function isoWeekKey(key: string): string {
  const d = parseDateKey(key);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - yearStart.getTime()) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${pad2(week)}`;
}

export function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDateKey(b).getTime() - parseDateKey(a).getTime()) / 86400000);
}

export function maskFromDays(days: boolean[]): number {
  let mask = 0;
  days.forEach((on, i) => {
    if (on) mask |= 1 << i;
  });
  return mask;
}

export function daysFromMask(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0);
}

export const WEEKDAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function describeDays(days: boolean[]): string {
  const count = days.filter(Boolean).length;
  if (count === 7) return 'Tous les jours';
  if (count === 0) return 'Jamais';
  const weekdays = days.slice(0, 5).every(Boolean) && !days[5] && !days[6];
  if (weekdays) return 'Lun – Ven';
  if (count === 2 && days[5] && days[6]) return 'Week-end';
  return days.map((on, i) => (on ? WEEKDAY_SHORT[i] : null)).filter(Boolean).join(' · ');
}

/** "2 h 04" à partir de minutes. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${pad2(m)}` : `${m} min`;
}
