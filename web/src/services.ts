import type { IconName } from './icons';

export interface ServiceMeta {
  icon: IconName;
  color: string;
}

// Icône + couleur de tuile par identifiant de service / intégration (maquettes).
const META: Record<string, ServiceMeta> = {
  icloud: { icon: 'calendar', color: '#FF453A' },
  spotify: { icon: 'musicNote', color: '#FF2D55' },
  roblox: { icon: 'roblox', color: '#2F6FE0' },
  pathe: { icon: 'film', color: '#00A699' },
  weather: { icon: 'cloud', color: '#32ADE6' },
  meteo: { icon: 'cloud', color: '#32ADE6' },
  bluetooth: { icon: 'bluetooth', color: '#5E5CE6' },
  iphone: { icon: 'bluetooth', color: '#5E5CE6' },
  ancs: { icon: 'bluetooth', color: '#5E5CE6' },
  device: { icon: 'display', color: '#636369' },
  tablet: { icon: 'display', color: '#636369' },
  vps: { icon: 'server', color: '#636369' },
  server: { icon: 'server', color: '#636369' },
  habits: { icon: 'checkCircle', color: '#30D158' },
};

export function serviceMeta(id: string): ServiceMeta {
  return META[id] ?? META[id.toLowerCase()] ?? { icon: 'puzzle', color: '#636369' };
}

// Libellés lisibles des sources du journal d'activité.
const SOURCE_LABELS: Record<string, string> = {
  vps: 'VPS',
  server: 'VPS',
  system: 'Système',
  device: 'Écran',
  tablet: 'Écran',
  habits: 'Habitudes',
  auth: 'Connexion',
  console: 'Console',
  spotify: 'Spotify',
  roblox: 'Roblox',
  pathe: 'Pathé',
  icloud: 'iCloud',
  weather: 'Météo',
  alarms: 'Réveils',
  backup: 'Sauvegarde',
  admin: 'Administration',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? SOURCE_LABELS[source.toLowerCase()] ?? source;
}

// Widgets de l'écran d'accueil.
export const WIDGET_LABELS: Record<string, string> = {
  clock: 'Horloge',
  weather: 'Météo',
  music: 'Spotify',
  agenda: 'Agenda',
  tasks: 'Tâches',
  roblox: 'Roblox',
  cinema: 'Prochaine séance ciné',
  streak: 'Série',
};

export const WIDGET_COLORS: Record<string, string> = {
  clock: '#222227',
  weather: '#132A4D',
  music: 'rgba(255,45,85,0.22)',
  agenda: 'rgba(255,69,58,0.18)',
  tasks: 'rgba(48,209,88,0.18)',
  roblox: 'rgba(10,132,255,0.2)',
  cinema: 'rgba(0,166,153,0.22)',
  streak: 'rgba(255,159,10,0.2)',
};

export function widgetLabel(id: string, fallback?: string): string {
  return WIDGET_LABELS[id] ?? fallback ?? id;
}
