import { useEffect, useState } from 'react';
import { SettingRow, Switch } from '../../components/ui';
import { minutesLabel, secondsLabel } from '../../format';
import type { DeviceInfo, Theme } from '../../types';
import { saveStatusLabel, type SettingsSaver } from './useSettingsSaver';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Sombre' },
  { value: 'light', label: 'Clair' },
  { value: 'auto', label: 'Auto' },
];
const SCREEN_SLEEP = [15, 30, 60, 120];
const DEEP_SLEEP = [5, 10, 30, 60];
const POLL = [15, 30, 60, 120, 300];

const withCurrent = (list: number[], current: number) => Array.from(new Set([...list, current])).sort((a, b) => a - b);

/** Curseur : valeur locale pendant le glissement, enregistrement (temporisé) au fil de l'eau. */
function Slider({
  id,
  value,
  min = 0,
  max = 100,
  onChange,
  label,
}: {
  id: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const pct = ((local - min) / (max - min)) * 100;
  return (
    <>
      <input
        id={id}
        className="range"
        type="range"
        min={min}
        max={max}
        step={1}
        value={local}
        aria-label={label}
        aria-valuetext={`${local} %`}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          onChange(v);
        }}
      />
      <span className="range-value">{local} %</span>
    </>
  );
}

export function ScreenCard({ device, saver }: { device: DeviceInfo; saver: SettingsSaver }) {
  const s = device.settings;
  const night = s.nightMode;

  return (
    <section className="card" aria-labelledby="screen-title">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2 className="card-title" id="screen-title">
          Écran &amp; énergie
        </h2>
        <span className={saver.status === 'error' ? 'card-sub text-error' : 'card-sub'} role="status">
          {saveStatusLabel(saver.status)}
        </span>
      </div>

      <SettingRow label="Luminosité" htmlFor="set-brightness">
        <Slider id="set-brightness" label="Luminosité" min={5} value={s.brightness} onChange={(v) => saver.update({ brightness: v })} />
      </SettingRow>

      <SettingRow label="Thème" htmlFor="set-theme">
        <select
          id="set-theme"
          className="select auto"
          value={s.theme}
          onChange={(e) => saver.update({ theme: e.target.value as Theme }, { immediate: true })}
        >
          {THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Mode nuit automatique" sub={night.enabled ? `${night.start} → ${night.end}` : 'Désactivé'}>
        <Switch
          checked={night.enabled}
          onChange={(v) => saver.update({ nightMode: { ...night, enabled: v } }, { immediate: true })}
          label="Mode nuit automatique"
        />
      </SettingRow>
      {night.enabled && (
        <div className="setting-sub-block">
          <div className="row-wrap" style={{ gap: 12 }}>
            <div className="field">
              <label className="field-label" htmlFor="night-start">
                Début
              </label>
              <input
                id="night-start"
                className="input time"
                type="time"
                value={night.start}
                onChange={(e) => e.target.value && saver.update({ nightMode: { ...night, start: e.target.value } })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="night-end">
                Fin
              </label>
              <input
                id="night-end"
                className="input time"
                type="time"
                value={night.end}
                onChange={(e) => e.target.value && saver.update({ nightMode: { ...night, end: e.target.value } })}
              />
            </div>
          </div>
          <div className="setting-row compact" style={{ borderTop: 'none' }}>
            <label className="setting-label" htmlFor="night-brightness">
              Luminosité la nuit
            </label>
            <div className="setting-control">
              <Slider
                id="night-brightness"
                label="Luminosité la nuit"
                min={1}
                max={60}
                value={night.brightness}
                onChange={(v) => saver.update({ nightMode: { ...night, brightness: v } })}
              />
            </div>
          </div>
        </div>
      )}

      <SettingRow label="Teinte chaude" sub="Réduit la lumière bleue en mode nuit">
        <Switch checked={s.warmTint} onChange={(v) => saver.update({ warmTint: v }, { immediate: true })} label="Teinte chaude" />
      </SettingRow>

      <SettingRow label="Écran en veille après" htmlFor="set-screen-sleep">
        <select
          id="set-screen-sleep"
          className="select auto"
          value={s.screenSleepSeconds}
          onChange={(e) => saver.update({ screenSleepSeconds: Number(e.target.value) }, { immediate: true })}
        >
          {withCurrent(SCREEN_SLEEP, s.screenSleepSeconds).map((v) => (
            <option key={v} value={v}>
              {secondsLabel(v)}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Veille profonde après" htmlFor="set-deep-sleep" sub="Économise la batterie ; l’écran se réveille au toucher ou au bouton">
        <select
          id="set-deep-sleep"
          className="select auto"
          value={s.deepSleepMinutes}
          onChange={(e) => saver.update({ deepSleepMinutes: Number(e.target.value) }, { immediate: true })}
        >
          {withCurrent(DEEP_SLEEP, s.deepSleepMinutes).map((v) => (
            <option key={v} value={v}>
              {minutesLabel(v)}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Réveil au toucher">
        <Switch checked={s.touchWake} onChange={(v) => saver.update({ touchWake: v }, { immediate: true })} label="Réveil au toucher" />
      </SettingRow>

      <SettingRow
        label="Synchronisation"
        htmlFor="set-poll"
        sub="Fréquence à laquelle l’écran vérifie les nouveautés (toutes les 8 s pendant la musique)"
      >
        <select
          id="set-poll"
          className="select auto"
          value={s.pollSeconds}
          onChange={(e) => saver.update({ pollSeconds: Number(e.target.value) }, { immediate: true })}
        >
          {withCurrent(POLL, s.pollSeconds).map((v) => (
            <option key={v} value={v}>
              {v === 60 ? 'Chaque minute' : `Toutes les ${secondsLabel(v)}`}
            </option>
          ))}
        </select>
      </SettingRow>

      {device.paired && typeof device.battery === 'number' && (
        <SettingRow label="Batterie">
          <span style={{ fontWeight: 700 }}>
            {device.battery} %{device.charging ? ' · en charge' : ''}
          </span>
        </SettingRow>
      )}
    </section>
  );
}

