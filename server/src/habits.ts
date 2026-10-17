import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import {
  addDays,
  dateKey,
  daysBetween,
  daysFromMask,
  describeDays,
  isoWeekKey,
  maskFromDays,
  mondayOf,
  parseDateKey,
  weekdayIndex,
  WEEKDAY_LETTERS,
} from './dates.js';

export const HABIT_ICONS = [
  'bed', 'drop', 'moon', 'chat', 'briefcase', 'dumbbell', 'book', 'sparkles',
  'run', 'heart', 'leaf', 'music', 'code', 'pill', 'sun', 'check',
] as const;

const SPORT_ICONS = new Set(['dumbbell', 'run']);

export interface HabitRow {
  id: number;
  name: string;
  icon: string;
  color: string;
  days: number;
  goal: string;
  remind_times: string;
  show_on_device: number;
  archived: number;
  position: number;
  created_at: string;
}

export interface StreakSettings {
  threshold: number;
  resetTime: string;
  jokersPerWeek: number;
}

export const DEFAULT_STREAK_SETTINGS: StreakSettings = { threshold: 7, resetTime: '00:00', jokersPerWeek: 1 };

export function getStreakSettings(db: DB): StreakSettings {
  return { ...DEFAULT_STREAK_SETTINGS, ...getSetting<Partial<StreakSettings>>(db, 'streak', {}) };
}

export function saveStreakSettings(db: DB, value: Partial<StreakSettings>): StreakSettings {
  const next = { ...getStreakSettings(db), ...value };
  next.threshold = Math.max(1, Math.min(50, Math.round(next.threshold)));
  next.jokersPerWeek = Math.max(0, Math.min(3, Math.round(next.jokersPerWeek)));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.resetTime)) next.resetTime = '00:00';
  setSetting(db, 'streak', next);
  return next;
}

/** Jour « de tâches » en cours : avant l'heure de remise à zéro, on est encore la veille. */
export function taskDate(db: DB, now = new Date()): string {
  const { resetTime } = getStreakSettings(db);
  const [h, m] = resetTime.split(':').map(Number);
  const key = dateKey(now);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return addDays(key, -1);
  return key;
}

export interface DayStats {
  date: string;
  done: number;
  total: number;
  validated: boolean;
}

/**
 * Vue en mémoire des habitudes et de leur historique : un seul aller-retour
 * en base par requête, puis tous les calculs (séries, taux) en mémoire.
 */
export class HabitBook {
  readonly habits: HabitRow[];
  readonly active: HabitRow[];
  readonly today: string;
  readonly settings: StreakSettings;
  private readonly logs = new Set<string>();
  private readonly logTimes = new Map<string, string>();
  readonly earliest: string;

  constructor(private readonly db: DB, now = new Date()) {
    this.settings = getStreakSettings(db);
    this.today = taskDate(db, now);
    this.habits = db.prepare('SELECT * FROM habits ORDER BY position, id').all() as HabitRow[];
    this.active = this.habits.filter((h) => !h.archived);
    for (const row of db.prepare('SELECT habit_id, date, done_at FROM habit_logs').all() as {
      habit_id: number;
      date: string;
      done_at: string;
    }[]) {
      const k = `${row.habit_id}|${row.date}`;
      this.logs.add(k);
      this.logTimes.set(k, row.done_at);
    }
    this.earliest = this.habits.reduce((min, h) => {
      const d = createdDate(h);
      return d < min ? d : min;
    }, this.today);
  }

  scheduled(h: HabitRow, date: string): boolean {
    return date >= createdDate(h) && (h.days & (1 << weekdayIndex(date))) !== 0;
  }

  isDone(h: HabitRow, date: string): boolean {
    return this.logs.has(`${h.id}|${date}`);
  }

  dayStats(date: string): DayStats {
    let total = 0;
    let done = 0;
    for (const h of this.active) {
      if (!this.scheduled(h, date)) continue;
      total++;
      if (this.isDone(h, date)) done++;
    }
    const need = Math.min(this.settings.threshold, total);
    return { date, done, total, validated: total > 0 && done >= need };
  }

  habitStreak(h: HabitRow): number {
    let streak = 0;
    const start = createdDate(h);
    for (let d = this.today, i = 0; d >= start && i < 1000; d = addDays(d, -1), i++) {
      if (!this.scheduled(h, d)) continue;
      if (this.isDone(h, d)) streak++;
      else if (d === this.today) continue;
      else break;
    }
    return streak;
  }

  habitBest(h: HabitRow): number {
    let best = 0;
    let cur = 0;
    for (let d = createdDate(h); d <= this.today; d = addDays(d, 1)) {
      if (!this.scheduled(h, d)) continue;
      if (this.isDone(h, d)) {
        cur++;
        best = Math.max(best, cur);
      } else if (d !== this.today) cur = 0;
    }
    return best;
  }

  habitRate(h: HabitRow, days = 30): number {
    let sched = 0;
    let done = 0;
    for (let i = 0; i < days; i++) {
      const d = addDays(this.today, -i);
      if (!this.scheduled(h, d)) continue;
      const isDone = this.isDone(h, d);
      if (d === this.today && !isDone) continue;
      sched++;
      if (isDone) done++;
    }
    return sched === 0 ? 0 : Math.round((done / sched) * 100);
  }

  streak(): number {
    let streak = 0;
    const jokers = new Map<string, number>();
    for (let d = this.today, i = 0; d >= this.earliest && i < 2000; d = addDays(d, -1), i++) {
      const s = this.dayStats(d);
      if (d === this.today) {
        if (s.validated) streak++;
        continue;
      }
      if (s.total === 0) continue;
      if (s.validated) {
        streak++;
        continue;
      }
      const wk = isoWeekKey(d);
      const used = jokers.get(wk) ?? 0;
      if (used < this.settings.jokersPerWeek) {
        jokers.set(wk, used + 1);
        continue;
      }
      break;
    }
    return streak;
  }

  bestStreak(): number {
    let best = 0;
    let cur = 0;
    const jokers = new Map<string, number>();
    for (let d = this.earliest; d <= this.today; d = addDays(d, 1)) {
      const s = this.dayStats(d);
      if (s.total === 0) continue;
      if (s.validated) {
        cur++;
        best = Math.max(best, cur);
        continue;
      }
      if (d === this.today) continue;
      const wk = isoWeekKey(d);
      const used = jokers.get(wk) ?? 0;
      if (used < this.settings.jokersPerWeek) {
        jokers.set(wk, used + 1);
        continue;
      }
      cur = 0;
    }
    return Math.max(best, this.streak());
  }

  /** Taux de réussite (tâches faites / prévues) entre deux dates incluses. */
  rateBetween(from: string, to: string): { rate: number; done: number; total: number } {
    let done = 0;
    let total = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const s = this.dayStats(d);
      if (d === this.today && s.done < s.total) {
        // Journée en cours : on ne compte que ce qui est déjà fait.
        done += s.done;
        total += s.done;
        continue;
      }
      done += s.done;
      total += s.total;
    }
    return { rate: total === 0 ? 0 : Math.round((done / total) * 100), done, total };
  }

  history(days: number): DayStats[] {
    const out: DayStats[] = [];
    for (let i = days - 1; i >= 0; i--) out.push(this.dayStats(addDays(this.today, -i)));
    return out;
  }

  countLogs(filter: (h: HabitRow, date: string, doneAt: string) => boolean): number {
    let n = 0;
    const byId = new Map(this.habits.map((h) => [h.id, h]));
    for (const [k, doneAt] of this.logTimes) {
      const [id, date] = k.split('|');
      const h = byId.get(Number(id));
      if (h && filter(h, date, doneAt)) n++;
    }
    return n;
  }

  week(): { label: string; date: string; state: 'done' | 'today' | 'missed' | 'future' | 'rest' }[] {
    const monday = mondayOf(this.today);
    return WEEKDAY_LETTERS.map((label, i) => {
      const date = addDays(monday, i);
      if (date > this.today) return { label, date, state: 'future' as const };
      const s = this.dayStats(date);
      if (s.validated) return { label, date, state: 'done' as const };
      if (date === this.today) return { label, date, state: 'today' as const };
      if (s.total === 0) return { label, date, state: 'rest' as const };
      return { label, date, state: 'missed' as const };
    });
  }
}

function createdDate(h: HabitRow): string {
  return dateKey(new Date(h.created_at));
}

export interface HabitDto {
  id: number;
  name: string;
  icon: string;
  color: string;
  days: boolean[];
  goal: string;
  remindTimes: string[];
  showOnDevice: boolean;
  archived: boolean;
  position: number;
  streak: number;
  bestStreak: number;
  rate30: number;
  doneToday: boolean;
}

export function toDto(book: HabitBook, h: HabitRow): HabitDto {
  return {
    id: h.id,
    name: h.name,
    icon: h.icon,
    color: h.color,
    days: daysFromMask(h.days),
    goal: h.goal,
    remindTimes: safeJsonArray(h.remind_times),
    showOnDevice: !!h.show_on_device,
    archived: !!h.archived,
    position: h.position,
    streak: book.habitStreak(h),
    bestStreak: book.habitBest(h),
    rate30: book.habitRate(h),
    doneToday: book.isDone(h, book.today),
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface HabitInput {
  name?: string;
  icon?: string;
  color?: string;
  days?: boolean[];
  goal?: string | null;
  remindTimes?: string[];
  showOnDevice?: boolean;
  archived?: boolean;
}

export class ValidationError extends Error {}

export function validateHabitInput(input: HabitInput, partial: boolean): void {
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.trim().length > 60) {
      throw new ValidationError('Le nom doit faire entre 1 et 60 caractères.');
    }
  }
  if (!partial || input.icon !== undefined) {
    if (!HABIT_ICONS.includes(input.icon as (typeof HABIT_ICONS)[number])) throw new ValidationError('Icône inconnue.');
  }
  if (!partial || input.color !== undefined) {
    if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new ValidationError('Couleur invalide (#RRGGBB).');
  }
  if (!partial || input.days !== undefined) {
    if (!Array.isArray(input.days) || input.days.length !== 7 || !input.days.some(Boolean)) {
      throw new ValidationError('Choisis au moins un jour.');
    }
  }
  if (input.goal === null) input.goal = '';
  if (input.goal !== undefined && (typeof input.goal !== 'string' || input.goal.length > 40)) {
    throw new ValidationError('Objectif trop long (40 caractères max).');
  }
  if (input.remindTimes !== undefined) {
    if (!Array.isArray(input.remindTimes) || input.remindTimes.length > 6 || !input.remindTimes.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      throw new ValidationError('Heures de rappel invalides (HH:MM, 6 max).');
    }
  }
}

export function createHabit(db: DB, input: HabitInput): number {
  validateHabitInput(input, false);
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM habits').get() as { p: number }).p;
  const res = db
    .prepare(
      `INSERT INTO habits (name, icon, color, days, goal, remind_times, show_on_device, archived, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      input.name!.trim(),
      input.icon,
      input.color,
      maskFromDays(input.days!),
      (input.goal ?? '').trim(),
      JSON.stringify(input.remindTimes ?? []),
      input.showOnDevice === false ? 0 : 1,
      pos,
      new Date().toISOString(),
    );
  return Number(res.lastInsertRowid);
}

export function updateHabit(db: DB, id: number, input: HabitInput): boolean {
  validateHabitInput(input, true);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) (sets.push('name = ?'), values.push(input.name.trim()));
  if (input.icon !== undefined) (sets.push('icon = ?'), values.push(input.icon));
  if (input.color !== undefined) (sets.push('color = ?'), values.push(input.color));
  if (input.days !== undefined) (sets.push('days = ?'), values.push(maskFromDays(input.days)));
  if (input.goal !== undefined && input.goal !== null) (sets.push('goal = ?'), values.push(input.goal.trim()));
  if (input.remindTimes !== undefined) (sets.push('remind_times = ?'), values.push(JSON.stringify(input.remindTimes)));
  if (input.showOnDevice !== undefined) (sets.push('show_on_device = ?'), values.push(input.showOnDevice ? 1 : 0));
  if (input.archived !== undefined) (sets.push('archived = ?'), values.push(input.archived ? 1 : 0));
  if (sets.length === 0) return !!db.prepare('SELECT 1 FROM habits WHERE id = ?').get(id);
  values.push(id);
  return db.prepare(`UPDATE habits SET ${sets.join(', ')} WHERE id = ?`).run(...values).changes > 0;
}

export function setHabitDone(db: DB, id: number, date: string, done: boolean): void {
  if (done) {
    db.prepare('INSERT OR IGNORE INTO habit_logs (habit_id, date, done_at) VALUES (?, ?, ?)').run(id, date, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date = ?').run(id, date);
  }
}

export interface Badge {
  id: string;
  label: string;
  unlocked: boolean;
  progress: number;
  target: number;
}

export function computeBadges(book: HabitBook): Badge[] {
  const streak = book.streak();
  const best = book.bestStreak();
  const sport = book.countLogs((h) => SPORT_ICONS.has(h.icon));
  const water = book.countLogs((h) => h.icon === 'drop');
  const early = book.countLogs((h, _date, doneAt) => h.icon === 'bed' && new Date(doneAt).getHours() < 8);
  let perfectWeeks = 0;
  const monday = mondayOf(book.today);
  for (let w = 1; w <= 52; w++) {
    const start = addDays(monday, -7 * w);
    if (start < mondayOf(book.earliest)) break;
    let ok = true;
    for (let i = 0; i < 7 && ok; i++) {
      const s = book.dayStats(addDays(start, i));
      if (s.total > 0 && !s.validated) ok = false;
    }
    if (ok) perfectWeeks++;
  }
  const mk = (id: string, label: string, value: number, target: number): Badge => ({
    id,
    label,
    unlocked: value >= target,
    progress: Math.min(value, target),
    target,
  });
  return [
    mk('streak7', 'Série de 7 j', best, 7),
    mk('streak21', 'Série de 21 j', best, 21),
    { ...mk('streak31', 'Série de 31 j', best, 31), progress: best >= 31 ? 31 : Math.min(streak, 31) },
    mk('sport50', '50 séances', sport, 50),
    mk('water100', '100 verres d’eau', water, 100),
    mk('early10', 'Lève-tôt', early, 10),
    mk('perfectWeek', 'Semaine parfaite', perfectWeeks, 1),
  ];
}

/** Minutes indiquées dans un objectif libre : « 45 min », « 1 h », « 2 h 30 ». */
export function goalMinutes(goal: string): number {
  const h = /(\d+)\s*h(?:\s*(\d+))?/i.exec(goal);
  if (h) return Number(h[1]) * 60 + Number(h[2] ?? 0);
  const m = /(\d+)\s*min/i.exec(goal);
  return m ? Number(m[1]) : 0;
}

export function habitMeta(h: HabitRow): string {
  return h.goal || describeDays(daysFromMask(h.days));
}

export function computeStats(db: DB, book: HabitBook, sportGoal: number) {
  const today = book.today;
  const monthStart = today.slice(0, 8) + '01';
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthStart = prevMonthEnd.slice(0, 8) + '01';
  const dayOfMonth = Number(today.slice(8, 10));
  const prevSameDay = addDays(prevMonthStart, Math.min(dayOfMonth, Number(prevMonthEnd.slice(8, 10))) - 1);

  const inRange = (from: string, to: string) => (_h: HabitRow, d: string) => d >= from && d <= to;
  const monthTasks = book.countLogs(inRange(monthStart, today));
  const prevMonthTasks = book.countLogs(inRange(prevMonthStart, prevSameDay));
  const sportSessions = book.countLogs((h, d) => SPORT_ICONS.has(h.icon) && d >= monthStart && d <= today);

  const thisWeek = book.rateBetween(mondayOf(today), today);
  const lastWeekStart = addDays(mondayOf(today), -7);
  const lastWeek = book.rateBetween(lastWeekStart, addDays(lastWeekStart, 6));
  const month = book.rateBetween(monthStart, today);

  const daily = book.history(14).map((s) => ({
    day: Number(s.date.slice(8, 10)),
    date: s.date,
    value: s.done,
    max: s.total,
    validated: s.validated,
    today: s.date === today,
  }));

  // Minutes de sport par semaine (8 dernières semaines), d'après l'objectif de chaque habitude sportive.
  const sportHabits = book.habits.filter((h) => SPORT_ICONS.has(h.icon));
  const sportWeekly: number[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = addDays(mondayOf(today), -7 * w);
    let minutes = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (d > today) break;
      for (const h of sportHabits) if (book.isDone(h, d)) minutes += goalMinutes(h.goal) || 45;
    }
    sportWeekly.push(minutes);
  }

  return {
    monthTasks,
    monthDeltaPct: prevMonthTasks > 0 ? Math.round(((monthTasks - prevMonthTasks) / prevMonthTasks) * 100) : 0,
    sportSessions,
    sportGoal,
    successRate: month.rate,
    successDeltaPts: thisWeek.rate - lastWeek.rate,
    weekRate: thisWeek.rate,
    daily,
    sportWeekly,
    threshold: book.settings.threshold,
  };
}

export function daysSinceStart(book: HabitBook): number {
  return daysBetween(book.earliest, book.today);
}

export { parseDateKey };
