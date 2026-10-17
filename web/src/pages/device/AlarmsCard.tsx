import { useState } from 'react';
import { api, errorMessage } from '../../api';
import { useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton, DayPicker, ErrorState, Field, Skeleton, Spinner, Switch } from '../../components/ui';
import { daysLabel, isValidTime, normalizeDays, WEEKDAYS } from '../../format';
import type { ApiData } from '../../hooks';
import { Icon } from '../../icons';
import type { Alarm, AlarmInput, AlarmSound, Routine } from '../../types';

export const SOUND_LABELS: Record<AlarmSound, string> = {
  aube: 'Aube douce',
  carillon: 'Carillon',
  pulsation: 'Pulsation',
  douce: 'Douce',
};
const SOUNDS = Object.keys(SOUND_LABELS) as AlarmSound[];
const SNOOZE_OPTIONS = [5, 9, 10, 15, 20];
const PRELIGHT_OPTIONS = [0, 5, 10, 15, 20, 30];

const sortAlarms = (list: Alarm[]) => list.slice().sort((a, b) => a.time.localeCompare(b.time));

export function AlarmsCard({ alarms, routine }: { alarms: ApiData<Alarm[]>; routine: ApiData<Routine> }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Alarm | 'new' | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const list = sortAlarms((alarms.data ?? []).map((a) => ({ ...a, days: normalizeDays(a.days) })));

  const replace = (a: Alarm) =>
    alarms.setData((l) => {
      const arr = l ?? [];
      return arr.some((x) => x.id === a.id) ? arr.map((x) => (x.id === a.id ? a : x)) : [...arr, a];
    });

  const toggle = async (a: Alarm, enabled: boolean) => {
    replace({ ...a, enabled });
    try {
      replace(await api.patch<Alarm>(`/api/alarms/${a.id}`, { enabled }));
    } catch (err) {
      replace(a);
      toast.error(errorMessage(err));
    }
  };

  const remove = async (a: Alarm) => {
    const yes = await confirm({
      title: `Supprimer le réveil de ${a.time} ?`,
      message: a.label ? `« ${a.label} » sera retiré de la tablette.` : undefined,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!yes) return;
    setBusyId(a.id);
    try {
      await api.del(`/api/alarms/${a.id}`);
      alarms.setData((l) => (l ? l.filter((x) => x.id !== a.id) : l));
      if (editing !== 'new' && editing?.id === a.id) setEditing(null);
      toast.success('Réveil supprimé.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card" aria-labelledby="alarms-title">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2 className="card-title" id="alarms-title">
          Réveils
        </h2>
        <button type="button" className="btn btn-sm" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          <Icon name="plus" size={15} strokeWidth={2.6} />
          Ajouter
        </button>
      </div>

      {alarms.error && !alarms.data ? (
        <ErrorState message={alarms.error} onRetry={() => void alarms.reload()} />
      ) : !alarms.data ? (
        <div className="stack" style={{ gap: 10, marginTop: 8 }}>
          <Skeleton height={60} radius={12} />
          <Skeleton height={60} radius={12} />
        </div>
      ) : (
        <>
          {list.length === 0 && editing !== 'new' && (
            <div className="empty">
              <strong>Aucun réveil</strong>
              Ajoute un réveil : la tablette sonnera même sans connexion.
            </div>
          )}
          <ul className="plain-list divided">
            {list.map((a) =>
              editing !== 'new' && editing?.id === a.id ? (
                <li key={a.id} style={{ padding: '12px 0' }}>
                  <AlarmForm
                    alarm={a}
                    onCancel={() => setEditing(null)}
                    onSaved={(saved) => {
                      replace({ ...saved, days: normalizeDays(saved.days) });
                      setEditing(null);
                    }}
                  />
                </li>
              ) : (
                <li key={a.id} className="alarm-row">
                  <div className="spacer" style={{ minWidth: 0, opacity: a.enabled ? 1 : 0.5 }}>
                    <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                      <span className="alarm-time">{a.time}</span>
                      <span className="alarm-label">{a.label || 'Réveil'}</span>
                    </div>
                    <div className="small muted">
                      {daysLabel(a.days)} · {SOUND_LABELS[a.sound] ?? a.sound} · répétition {a.snoozeMinutes} min
                    </div>
                  </div>
                  <button type="button" className="icon-btn" aria-label={`Modifier le réveil de ${a.time}`} onClick={() => setEditing(a)}>
                    <Icon name="pencil" size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`Supprimer le réveil de ${a.time}`}
                    onClick={() => void remove(a)}
                    disabled={busyId === a.id}
                  >
                    {busyId === a.id ? <Spinner /> : <Icon name="trash" size={17} />}
                  </button>
                  <Switch
                    checked={a.enabled}
                    onChange={(v) => void toggle(a, v)}
                    label={`Réveil de ${a.time}${a.label ? `, ${a.label}` : ''}`}
                  />
                </li>
              ),
            )}
          </ul>
          {editing === 'new' && (
            <div style={{ padding: '12px 0', borderTop: list.length ? '1px solid var(--border)' : undefined }}>
              <AlarmForm
                alarm={null}
                onCancel={() => setEditing(null)}
                onSaved={(saved) => {
                  replace({ ...saved, days: normalizeDays(saved.days) });
                  setEditing(null);
                }}
              />
            </div>
          )}
        </>
      )}

      <RoutineBlock routine={routine} />
    </section>
  );
}

// ---------- Formulaire de réveil ----------
function AlarmForm({ alarm, onCancel, onSaved }: { alarm: Alarm | null; onCancel: () => void; onSaved: (a: Alarm) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<AlarmInput>(
    alarm
      ? { time: alarm.time, label: alarm.label, days: normalizeDays(alarm.days), sound: alarm.sound, enabled: alarm.enabled, snoozeMinutes: alarm.snoozeMinutes }
      : { time: '07:00', label: '', days: WEEKDAYS, sound: 'aube', enabled: true, snoozeMinutes: 9 },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = alarm ? `alarm-${alarm.id}` : 'alarm-new';

  const submit = async () => {
    if (!isValidTime(form.time)) {
      setError('Indique une heure valide.');
      return;
    }
    if (!form.days.some(Boolean)) {
      setError('Choisis au moins un jour.');
      return;
    }
    setError(null);
    setBusy(true);
    const body = { ...form, label: form.label.trim() };
    try {
      const saved = alarm ? await api.patch<Alarm>(`/api/alarms/${alarm.id}`, body) : await api.post<Alarm>('/api/alarms', body);
      onSaved(saved);
      toast.success(alarm ? 'Réveil modifié.' : `Réveil ajouté pour ${saved.time}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack alarm-form"
      style={{ gap: 14 }}
      aria-label={alarm ? `Modifier le réveil de ${alarm.time}` : 'Nouveau réveil'}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <div className="form-grid">
        <Field label="Heure" htmlFor={`${prefix}-time`}>
          <input
            id={`${prefix}-time`}
            className="input"
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
            required
            autoFocus
          />
        </Field>
        <Field label="Nom" htmlFor={`${prefix}-label`}>
          <input
            id={`${prefix}-label`}
            className="input"
            type="text"
            maxLength={30}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Semaine"
          />
        </Field>
      </div>
      <DayPicker small value={form.days} onChange={(days) => setForm({ ...form, days })} />
      <div className="form-grid">
        <Field label="Sonnerie" htmlFor={`${prefix}-sound`}>
          <select
            id={`${prefix}-sound`}
            className="select"
            value={form.sound}
            onChange={(e) => setForm({ ...form, sound: e.target.value as AlarmSound })}
          >
            {SOUNDS.map((s) => (
              <option key={s} value={s}>
                {SOUND_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Répétition (snooze)" htmlFor={`${prefix}-snooze`}>
          <select
            id={`${prefix}-snooze`}
            className="select"
            value={form.snoozeMinutes}
            onChange={(e) => setForm({ ...form, snoozeMinutes: Number(e.target.value) })}
          >
            {Array.from(new Set([...SNOOZE_OPTIONS, form.snoozeMinutes]))
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
          </select>
        </Field>
      </div>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm btn-outline" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <BusyButton type="submit" className="btn btn-sm btn-primary" busy={busy}>
          {alarm ? 'Enregistrer' : 'Ajouter le réveil'}
        </BusyButton>
      </div>
    </form>
  );
}

// ---------- Routine matinale ----------
function RoutineBlock({ routine }: { routine: ApiData<Routine> }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const r = routine.data;

  const update = async (patch: Partial<Routine>) => {
    if (!r) return;
    const previous = r;
    const next = { ...r, ...patch };
    routine.setData(next);
    setSaving(true);
    try {
      routine.setData(await api.put<Routine>('/api/routine', next));
    } catch (err) {
      routine.setData(previous);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inset" style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 12 }}>
        <Icon name="sunWake" size={20} strokeWidth={2.2} style={{ color: 'var(--yellow)' }} />
        <div className="spacer">
          <div style={{ fontWeight: 600 }}>Routine matinale</div>
          <div className="small muted">
            {r
              ? r.enabled
                ? `Écran progressif ${r.preLightMinutes} min avant${r.showBriefing ? ' · météo et agenda à l’arrêt' : ''}`
                : 'Désactivée'
              : routine.error
                ? routine.error
                : 'Chargement…'}
          </div>
        </div>
        {saving && <Spinner />}
        {r && <Switch checked={r.enabled} onChange={(v) => void update({ enabled: v })} label="Activer la routine matinale" />}
      </div>
      {r && r.enabled && (
        <div style={{ marginTop: 8 }}>
          <div className="setting-row compact">
            <label className="setting-label" htmlFor="routine-prelight">
              Lumière progressive avant l’alarme
            </label>
            <select
              id="routine-prelight"
              className="select auto"
              value={r.preLightMinutes}
              onChange={(e) => void update({ preLightMinutes: Number(e.target.value) })}
            >
              {Array.from(new Set([...PRELIGHT_OPTIONS, r.preLightMinutes]))
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'Aucune' : `${m} min`}
                  </option>
                ))}
            </select>
          </div>
          <div className="setting-row compact">
            <span className="setting-label" id="routine-briefing-label">
              Briefing à l’arrêt
              <span className="sub">Météo et agenda du jour</span>
            </span>
            <Switch checked={r.showBriefing} onChange={(v) => void update({ showBriefing: v })} label="Afficher le briefing à l’arrêt de l’alarme" />
          </div>
          <div className="setting-row compact">
            <span className="setting-label">Rappel « boire un verre d’eau »</span>
            <Switch checked={r.waterReminder} onChange={(v) => void update({ waterReminder: v })} label="Rappel boire un verre d’eau" />
          </div>
        </div>
      )}
    </div>
  );
}
