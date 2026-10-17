// Types calqués sur docs/API.md (console web, routes /api/...).

/** 7 booléens, du lundi au dimanche. */
export type WeekDays = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

// ---------- Authentification ----------
export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  totpEnabled: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface Session {
  id: string | number;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface Ok {
  ok: true;
}

// ---------- Vue d'ensemble ----------
export interface OverviewDevice {
  paired: boolean;
  online: boolean;
  name?: string;
  lastSeenAt?: string | null;
  battery?: number | null;
  charging?: boolean;
  firmware?: string | null;
  rssi?: number | null;
  ip?: string | null;
  autonomyDays?: number | null;
}

export type ServiceStatus = 'ok' | 'warning' | 'error' | 'disabled' | 'local';
export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export interface ServiceState {
  id: string;
  name: string;
  status: ServiceStatus;
  detail?: string;
}

export interface ActivityEvent {
  id: number;
  ts: string;
  source: string;
  level: EventLevel;
  message: string;
}

export interface TodaySummary {
  date: string;
  done: number;
  total: number;
  streak: number;
  bestStreak: number;
}

export interface Overview {
  device: OverviewDevice;
  lastSync: string | null;
  today: TodaySummary;
  services: ServiceState[];
  events: ActivityEvent[];
}

export type DeviceCommandType = 'wake' | 'lock' | 'reboot' | 'message' | 'reload' | 'screenshot';

// ---------- Habitudes ----------
export const HABIT_ICONS = [
  'bed',
  'drop',
  'moon',
  'chat',
  'briefcase',
  'dumbbell',
  'book',
  'sparkles',
  'run',
  'heart',
  'leaf',
  'music',
  'code',
  'pill',
  'sun',
  'check',
] as const;
export type HabitIcon = (typeof HABIT_ICONS)[number];

export interface Habit {
  id: number;
  name: string;
  icon: HabitIcon | string;
  color: string;
  days: WeekDays;
  goal: string | null;
  remindTimes: string[];
  showOnDevice: boolean;
  archived: boolean;
  position: number;
  streak: number;
  bestStreak: number;
  rate30: number;
  doneToday: boolean;
}

export interface HabitInput {
  name: string;
  icon: string;
  color: string;
  days: WeekDays;
  goal?: string | null;
  remindTimes?: string[];
  showOnDevice?: boolean;
}

export interface StreakSettings {
  threshold: number;
  resetTime: string;
  jokersPerWeek: number;
}

export interface Badge {
  id: string | number;
  label: string;
  unlocked: boolean;
  progress: number;
  target: number;
}

export interface HistoryDay {
  date: string;
  done: number;
  total: number;
  validated: boolean;
}

// ---------- Réveils & routine ----------
export type AlarmSound = 'aube' | 'carillon' | 'pulsation' | 'douce';

export interface Alarm {
  id: number;
  time: string;
  label: string;
  days: WeekDays;
  sound: AlarmSound;
  enabled: boolean;
  snoozeMinutes: number;
}

export type AlarmInput = Omit<Alarm, 'id'>;

export interface Routine {
  enabled: boolean;
  preLightMinutes: number;
  showBriefing: boolean;
  waterReminder: boolean;
}

// ---------- Appareil ----------
export type Theme = 'dark' | 'light' | 'auto';

export interface NightMode {
  enabled: boolean;
  start: string;
  end: string;
  brightness: number;
}

export interface DeviceSettings {
  brightness: number;
  theme: Theme;
  nightMode: NightMode;
  warmTint: boolean;
  screenSleepSeconds: number;
  deepSleepMinutes: number;
  touchWake: boolean;
  lockOnWake: boolean;
  lockAfterMinutes: number;
  pollSeconds: number;
}

export type WidgetId = 'clock' | 'weather' | 'music' | 'agenda' | 'tasks' | 'roblox' | 'cinema' | 'streak';

export interface LayoutItem {
  id: WidgetId | string;
  span: 1 | 2;
}

export interface AvailableWidget {
  id: WidgetId | string;
  label: string;
}

export interface DeviceInfo {
  paired: boolean;
  name?: string | null;
  firmware?: string | null;
  lastSeenAt?: string | null;
  battery?: number | null;
  charging?: boolean;
  online: boolean;
  rssi?: number | null;
  ip?: string | null;
  pinSet: boolean;
  pinUpdatedAt?: string | null;
  settings: DeviceSettings;
  layout: LayoutItem[];
  availableWidgets: AvailableWidget[];
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

// ---------- Intégrations ----------
export type IntegrationId = 'spotify' | 'roblox' | 'pathe' | 'icloud' | 'weather' | string;
export type FieldType = 'text' | 'secret' | 'readonly' | 'number' | 'select' | 'time-list' | 'chips';

export interface FieldOption {
  value: string;
  label: string;
}

export interface IntegrationField {
  key: string;
  label: string;
  type: FieldType;
  mono?: boolean;
  copyable?: boolean;
  options?: FieldOption[];
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
}

export interface SecretState {
  set: boolean;
  preview?: string | null;
}

export interface IntegrationAction {
  id: string;
  label: string;
}

export type ConfigValue = string | number | boolean | null | string[] | number[] | unknown;

export interface Integration {
  id: IntegrationId;
  name: string;
  description: string;
  enabled: boolean;
  status: ServiceStatus;
  statusDetail?: string | null;
  lastRunAt?: string | null;
  config: Record<string, ConfigValue>;
  secrets: Record<string, SecretState>;
  fields: IntegrationField[];
  actions: IntegrationAction[];
}

export interface IntegrationUpdate {
  enabled?: boolean;
  config?: Record<string, ConfigValue>;
  secrets?: Record<string, string | null>;
}

export interface TestResult {
  ok: boolean;
  ms?: number;
  message?: string;
}

export interface RobloxResolve {
  universeId: number | string;
  name: string;
}

export interface PatheCinema {
  id: string;
  name: string;
  city?: string;
}

export interface ICloudCalendar {
  id: string;
  name: string;
  color?: string;
}
