import { getCache, setCache } from '../db.js';
import { fetchJson } from '../http.js';
import { config as appConfig } from '../config.js';
import { ConfigError, num, str, type IntegrationDef } from './types.js';

export interface WeatherData {
  label: string;
  temp: number;
  code: number;
  text: string;
  icon: string;
  isDay: boolean;
  max: number;
  min: number;
  hourly: { hour: string; temp: number; icon: string }[];
}

interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[] };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
}

/** Codes WMO → libellé français + icône utilisée par la tablette. */
export function describeWeather(code: number, isDay = true): { text: string; icon: string } {
  if (code === 0) return { text: 'Ciel dégagé', icon: isDay ? 'sun' : 'moon' };
  if (code === 1) return { text: 'Plutôt dégagé', icon: isDay ? 'partly' : 'moon' };
  if (code === 2) return { text: 'Éclaircies', icon: 'partly' };
  if (code === 3) return { text: 'Couvert', icon: 'cloud' };
  if (code === 45 || code === 48) return { text: 'Brouillard', icon: 'fog' };
  if (code >= 51 && code <= 57) return { text: 'Bruine', icon: 'rain' };
  if (code >= 61 && code <= 67) return { text: 'Pluie', icon: 'rain' };
  if (code >= 71 && code <= 77) return { text: 'Neige', icon: 'snow' };
  if (code >= 80 && code <= 82) return { text: 'Averses', icon: 'rain' };
  if (code === 85 || code === 86) return { text: 'Averses de neige', icon: 'snow' };
  if (code >= 95) return { text: 'Orage', icon: 'storm' };
  return { text: 'Variable', icon: 'cloud' };
}

async function fetchWeather(lat: number, lon: number, label: string): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,weather_code,is_day');
  url.searchParams.set('hourly', 'temperature_2m,weather_code');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
  url.searchParams.set('timezone', appConfig.tz);
  url.searchParams.set('forecast_days', '2');
  const data = await fetchJson<OpenMeteoResponse>(url.toString());

  const now = new Date();
  const hourly: WeatherData['hourly'] = [];
  for (let i = 0; i < data.hourly.time.length && hourly.length < 4; i++) {
    // Les heures renvoyées sont locales (paramètre timezone) : « 2026-10-17T09:00 ».
    const t = new Date(data.hourly.time[i]);
    if (t.getTime() <= now.getTime()) continue;
    if (t.getHours() % 3 !== 0) continue;
    const d = describeWeather(data.hourly.weather_code[i], t.getHours() >= 7 && t.getHours() < 20);
    hourly.push({ hour: `${t.getHours()} h`, temp: Math.round(data.hourly.temperature_2m[i]), icon: d.icon });
  }
  const cur = describeWeather(data.current.weather_code, data.current.is_day === 1);
  return {
    label,
    temp: Math.round(data.current.temperature_2m),
    code: data.current.weather_code,
    text: cur.text,
    icon: cur.icon,
    isDay: data.current.is_day === 1,
    max: Math.round(data.daily.temperature_2m_max[0]),
    min: Math.round(data.daily.temperature_2m_min[0]),
    hourly,
  };
}

export const weather: IntegrationDef = {
  id: 'weather',
  name: 'Météo',
  description: 'Prévisions du jour et par heure',
  defaults: { label: 'Domicile', latitude: '', longitude: '', intervalMinutes: 15 },
  secretFields: [],
  fields: () => [
    { key: 'provider', label: 'Fournisseur', type: 'readonly' },
    { key: 'label', label: 'Nom affiché', type: 'text', placeholder: 'Domicile' },
    { key: 'latitude', label: 'Latitude', type: 'number', placeholder: '48.8566', min: -90, max: 90 },
    { key: 'longitude', label: 'Longitude', type: 'number', placeholder: '2.3522', min: -180, max: 180 },
    {
      key: 'intervalMinutes',
      label: 'Mise à jour',
      type: 'select',
      options: [
        { value: '10', label: 'Toutes les 10 minutes' },
        { value: '15', label: 'Toutes les 15 minutes' },
        { value: '30', label: 'Toutes les 30 minutes' },
        { value: '60', label: 'Toutes les heures' },
      ],
    },
  ],
  missing: (ctx) => (ctx.config.latitude === '' || ctx.config.longitude === '' ? 'Indique la latitude et la longitude de ton domicile.' : null),
  isDue: (ctx, last, now) => !last || now.getTime() - last.getTime() >= Number(ctx.config.intervalMinutes || 15) * 60_000,
  async run(ctx) {
    const data = await fetchWeather(Number(ctx.config.latitude), Number(ctx.config.longitude), ctx.config.label || 'Domicile');
    setCache(ctx.db, 'weather', data);
    const time = new Date().toTimeString().slice(0, 5);
    return { status: 'ok', detail: `${data.temp}° · ${data.text} · mise à jour à ${time}` };
  },
  async test(ctx) {
    const data = await fetchWeather(Number(ctx.config.latitude), Number(ctx.config.longitude), ctx.config.label || 'Domicile');
    return `${data.temp}° · ${data.text}`;
  },
  sanitizeConfig(patch) {
    const out: Record<string, unknown> = {};
    if ('label' in patch) out.label = str(patch.label, 30) || 'Domicile';
    if ('latitude' in patch) out.latitude = patch.latitude === '' ? '' : num(patch.latitude, -90, 90, 'La latitude');
    if ('longitude' in patch) out.longitude = patch.longitude === '' ? '' : num(patch.longitude, -180, 180, 'La longitude');
    if ('intervalMinutes' in patch) {
      const v = Number(patch.intervalMinutes);
      if (![10, 15, 30, 60].includes(v)) throw new ConfigError('Intervalle invalide.');
      out.intervalMinutes = v;
    }
    return out;
  },
  computed: () => ({ provider: WEATHER_PROVIDER }),
};

export function weatherForDevice(db: Parameters<typeof getCache>[0]): WeatherData | null {
  return getCache<WeatherData>(db, 'weather')?.value ?? null;
}

/** Valeur affichée en lecture seule. */
export const WEATHER_PROVIDER = 'Open-Meteo · aucune clé nécessaire';
