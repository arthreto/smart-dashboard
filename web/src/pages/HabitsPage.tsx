import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { useOverview } from '../components/Layout';
import { useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { BusyButton, DayPicker, ErrorState, Field, Skeleton, Spinner, Switch } from '../components/ui';
import { ALL_DAYS, countDays, daysLabel, isValidTime, normalizeDays, plural } from '../format';
import { useApiData, useDocumentTitle } from '../hooks';
import { FlameIcon, HabitGlyph, Icon } from '../icons';
import { HABIT_ICONS, type Badge, type Habit, type HabitInput, type HistoryDay, type StreakSettings, type WeekDays } from '../types';

type Filter = 'all' | 'daily' | 'some' | 'archived';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'daily', label: 'Quotidiennes' },
  { id: 'some', label: 'Certains jours' },
  { id: 'archived', label: 'Archivées' },
];

export const HABIT_COLORS = ['#0FA5C8', '#0A84FF', '#BF5AF2', '#FF9F0A', '#2F6FE0', '#28A745', '#E5484D', '#5E5CE6'];

const COLOR_NAMES: Record<string, string> = {
  '#0FA5C8': 'Turquoise',
  '#0A84FF': 'Bleu',
  '#BF5AF2': 'Violet',
  '#FF9F0A': 'Orange',
  '#2F6FE0': 'Bleu roi',
  '#28A745': 'Vert',
  '#E5484D': 'Rouge',
  '#5E5CE6': 'Indigo',
};

const ICON_NAMES: Record<string, string> = {
  bed: 'Lit',
  drop: 'Goutte',
  moon: 'Lune',
  chat: 'Bulle',
  briefcase: 'Travail',
  dumbbell: 'Haltère',
  book: 'Livre',
  sparkles: 'Étincelles',
  run: 'Course',
  heart: 'Cœur',
  leaf: 'Feuille',
  music: 'Musique',
  code: 'Code',
  pill: 'Médicament',
  sun: 'Soleil',
  check: 'Coche',
};

function normalizeHabit(h: Habit): Habit {
  return { ...h, days: normalizeDays(h.days), remindTimes: h.remindTimes ?? [] };
}

export function HabitsPage() {
  useDocumentTitle('Tâches & habitudes');
  const toast = useToast();
  const overview = useOverview();
  const active = useApiData<Habit[]>('/api/habits?archived=0');
  const archived = useApiData<Habit[]>('/api/habits?archived=1');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const editorRef = useRef<HTMLElement>(null);

  const activeList = useMemo(() => (active.data ?? []).map(normalizeHabit).sort((a, b) => a.position - b.position), [active.data]);
  const archivedList = useMemo(() => (archived.data ?? []).map(normalizeHabit), [archived.data]);

  const counts: Record<Filter, number> = {
    all: activeList.length,
    daily: activeList.filter((h) => countDays(h.days) === 7).length,
    some: activeList.filter((h) => countDays(h.days) < 7).length,
    archived: archivedList.length,
  };

  const rows =
    filter === 'archived'
      ? archivedList
      : filter === 'daily'
        ? activeList.filter((h) => countDays(h.days) === 7)
        : filter === 'some'
          ? activeList.filter((h) => countDays(h.days) < 7)
          : activeList;

  const listLoading = filter === 'archived' ? archived.loading && !archived.data : active.loading && !active.data;
  const listError = filter === 'archived' ? archived.error : active.error;

  const openEditor = (target: Habit | 'new') => {
    setEditing(target);
    window.setTimeout(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }, 50);
  };

  const replaceHabit = (next: Habit) => {
    const n = normalizeHabit(next);
    const target = n.archived ? archived : active;
    const other = n.archived ? active : archived;
    target.setData((list) => {
      const arr = list ?? [];
      return arr.some((h) => h.id === n.id) ? arr.map((h) => (h.id === n.id ? n : h)) : [...arr, n];
    });
    other.setData((list) => (list ? list.filter((h) => h.id !== n.id) : list));
  };

  const removeHabit = (id: number) => {
    active.setData((list) => (list ? list.filter((h) => h.id !== id) : list));
    archived.setData((list) => (list ? list.filter((h) => h.id !== id) : list));
  };

  const toggleShow = async (h: Habit, value: boolean) => {
    replaceHabit({ ...h, showOnDevice: value });
    try {
      replaceHabit(await api.patch<Habit>(`/api/habits/${h.id}`, { showOnDevice: value }));
    } catch (err) {
      replaceHabit(h);
      toast.error(errorMessage(err));
    }
  };

  /** Échange une habitude avec sa voisine visible (dans le filtre courant), puis enregistre l'ordre complet. */
  const move = async (h: Habit, dir: -1 | 1) => {
    const visibleIdx = rows.findIndex((r) => r.id === h.id);
    const neighbour = rows[visibleIdx + dir];
    if (!neighbour) return;
    const ids = activeList.map((x) => x.id);
    const a = ids.indexOf(h.id);
    const b = ids.indexOf(neighbour.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    const previous = active.data;
    active.setData(ids.map((id, position) => ({ ...activeList.find((x) => x.id === id)!, position })));
    try {
      await api.post('/api/habits/reorder', { ids });
    } catch (err) {
      active.setData(previous);
      toast.error(errorMessage(err));
    }
  };

  const streak = overview.data?.today.streak;
  const kicker = active.data
    ? `${plural(activeList.length, 'habitude')}${typeof streak === 'number' ? ` · série de ${plural(streak, 'jour')}` : ''}`
    : 'Chargement…';

  const selectedId = editing && editing !== 'new' ? editing.id : null;
  const canReorder = filter !== 'archived';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">Tâches &amp; habitudes</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openEditor('new')}>
          <Icon name="plus" size={17} strokeWidth={2.6} />
          Nouvelle habitude
        </button>
      </header>

      <section className="card card-tight" aria-label="Liste des habitudes">
        <div className="tabs" role="tablist" aria-label="Filtre" style={{ padding: '8px 10px 12px' }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              id={`tab-${f.id}`}
              aria-selected={filter === f.id}
              aria-controls="habits-panel"
              className="tab"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {(f.id === 'archived' ? archived.data : active.data) ? ` · ${counts[f.id]}` : ''}
            </button>
          ))}
        </div>

        <div id="habits-panel" role="tabpanel" aria-labelledby={`tab-${filter}`}>
          {listError && !rows.length ? (
            <div style={{ padding: '0 10px 6px' }}>
              <ErrorState message={listError} onRetry={() => void (filter === 'archived' ? archived.reload() : active.reload())} />
            </div>
          ) : listLoading ? (
            <div className="stack" style={{ padding: '4px 14px 8px', gap: 10 }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} height={40} radius={10} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              {filter === 'archived' ? (
                <>
                  <strong>Aucune habitude archivée</strong>
                  Les habitudes archivées gardent leur historique et peuvent être restaurées.
                </>
              ) : filter === 'all' ? (
                <>
                  <strong>Aucune habitude pour l’instant</strong>
                  Crée ta première habitude pour la voir sur l’écran.
                </>
              ) : (
                <>
                  <strong>Rien dans ce filtre</strong>
                </>
              )}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table roomy" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    {canReorder && (
                      <th style={{ width: 76 }}>
                        <span className="sr-only">Ordre</span>
                      </th>
                    )}
                    <th>Habitude</th>
                    <th>Fréquence</th>
                    <th>Rappel</th>
                    <th>Série</th>
                    <th style={{ width: 170 }}>Réussite sur 30 j</th>
                    <th>Sur l’écran</th>
                    <th style={{ width: 48 }}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h, i) => (
                    <tr key={h.id} className={h.id === selectedId ? 'selected' : undefined}>
                      {canReorder && (
                        <td style={{ paddingRight: 0 }}>
                          <div className="row" style={{ gap: 2 }}>
                            <button
                              type="button"
                              className="icon-btn sm"
                              aria-label={`Monter « ${h.name} »`}
                              disabled={i === 0}
                              onClick={() => void move(h, -1)}
                            >
                              <Icon name="chevronUp" size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn sm"
                              aria-label={`Descendre « ${h.name} »`}
                              disabled={i === rows.length - 1}
                              onClick={() => void move(h, 1)}
                            >
                              <Icon name="chevronDown" size={16} />
                            </button>
                          </div>
                        </td>
                      )}
                      <td>
                        <div className="row" style={{ gap: 12 }}>
                          <span className="tile sm" style={{ background: h.color }} aria-hidden="true">
                            <HabitGlyph icon={h.icon} size={15} />
                          </span>
                          <span>
                            <span style={{ fontSize: 15, fontWeight: 600 }}>{h.name}</span>
                            {h.goal && <span className="sub">{h.goal}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="text-2">{daysLabel(h.days)}</td>
                      <td className="text-2 tabular">{h.remindTimes.length ? h.remindTimes.join(' · ') : '—'}</td>
                      <td>
                        <span className="streak" aria-label={`Série de ${plural(h.streak, 'jour')}`}>
                          <FlameIcon />
                          {h.streak} j
                        </span>
                      </td>
                      <td>
                        <div className="row">
                          <div
                            className="progress thin blue spacer"
                            role="progressbar"
                            aria-label={`Réussite de « ${h.name} » sur 30 jours`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={h.rate30}
                          >
                            <span style={{ width: `${Math.max(0, Math.min(100, h.rate30))}%` }} />
                          </div>
                          <span className="tabular" style={{ width: 42, textAlign: 'right', fontWeight: 600 }}>
                            {Math.round(h.rate30)} %
                          </span>
                        </div>
                      </td>
                      <td>
                        <Switch
                          checked={h.showOnDevice}
                          onChange={(v) => void toggleShow(h, v)}
                          label={`Afficher « ${h.name} » sur l’écran`}
                          disabled={h.archived}
                        />
                      </td>
                      <td style={{ paddingLeft: 4, paddingRight: 8 }}>
                        <button type="button" className="icon-btn" aria-label={`Modifier « ${h.name} »`} onClick={() => openEditor(h)}>
                          <Icon name="pencil" size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="grid-2">
        <section ref={editorRef} className="card flex-col" aria-labelledby="habit-editor-title" style={{ gap: 16, scrollMarginTop: 16 }}>
          {editing ? (
            <HabitEditor
              key={editing === 'new' ? 'new' : editing.id}
              habit={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={(h) => {
                replaceHabit(h);
                setEditing(normalizeHabit(h));
              }}
              onDeleted={(id) => {
                removeHabit(id);
                setEditing(null);
              }}
              onArchived={(h) => {
                replaceHabit(h);
                setEditing(null);
              }}
            />
          ) : (
            <>
              <h2 className="card-title" id="habit-editor-title">
                Modifier une habitude
              </h2>
              <div className="empty" style={{ padding: '20px 8px' }}>
                <strong>Aucune habitude sélectionnée</strong>
                Clique sur le crayon d’une ligne pour la modifier, ou crée une nouvelle habitude.
              </div>
              <button type="button" className="btn btn-outline" onClick={() => openEditor('new')}>
                <Icon name="plus" size={17} strokeWidth={2.6} />
                Nouvelle habitude
              </button>
            </>
          )}
        </section>

        <StreakCard />
      </div>
    </div>
  );
}

// ---------- Éditeur d'habitude ----------
function HabitEditor({
  habit,
  onClose,
  onSaved,
  onDeleted,
  onArchived,
}: {
  habit: Habit | null;
  onClose: () => void;
  onSaved: (h: Habit) => void;
  onDeleted: (id: number) => void;
  onArchived: (h: Habit) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(habit?.name ?? '');
  const [icon, setIcon] = useState<string>(habit?.icon ?? 'check');
  const [color, setColor] = useState(habit?.color ?? HABIT_COLORS[1]);
  const [days, setDays] = useState<WeekDays>(habit ? normalizeDays(habit.days) : ALL_DAYS);
  const [goal, setGoal] = useState(habit?.goal ?? '');
  const [times, setTimes] = useState<string[]>(habit?.remindTimes ?? []);
  const [show, setShow] = useState(habit?.showOnDevice ?? true);
  const [busy, setBusy] = useState<'save' | 'archive' | 'delete' | null>(null);
  const [errors, setErrors] = useState<{ name?: string; days?: string; times?: string }>({});

  const isNew = habit === null;

  const validate = () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Donne un nom à l’habitude.';
    else if (name.trim().length > 40) e.name = '40 caractères maximum (affichage sur l’écran).';
    if (countDays(days) === 0) e.days = 'Choisis au moins un jour.';
    if (times.some((t) => !isValidTime(t))) e.times = 'Une heure de rappel est incomplète.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const body: HabitInput = {
      name: name.trim(),
      icon,
      color,
      days,
      goal: goal.trim() || null,
      remindTimes: Array.from(new Set(times)).sort(),
      showOnDevice: show,
    };
    setBusy('save');
    try {
      const saved = isNew ? await api.post<Habit>('/api/habits', body) : await api.patch<Habit>(`/api/habits/${habit.id}`, body);
      onSaved(saved);
      toast.success(isNew ? `Habitude « ${saved.name} » créée.` : 'Habitude enregistrée.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    if (!habit) return;
    const next = !habit.archived;
    setBusy('archive');
    try {
      const saved = await api.patch<Habit>(`/api/habits/${habit.id}`, { archived: next });
      onArchived(saved);
      toast.success(next ? `« ${habit.name} » archivée. Son historique est conservé.` : `« ${habit.name} » restaurée.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!habit) return;
    const yes = await confirm({
      title: `Supprimer « ${habit.name} » ?`,
      message: 'L’habitude et tout son historique seront effacés définitivement. Pour la mettre de côté sans rien perdre, archive-la plutôt.',
      confirmLabel: 'Supprimer définitivement',
      danger: true,
    });
    if (!yes) return;
    setBusy('delete');
    try {
      await api.del(`/api/habits/${habit.id}`);
      onDeleted(habit.id);
      toast.success('Habitude supprimée.');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <form
      className="stack"
      style={{ gap: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <div className="card-head">
        <h2 className="card-title" id="habit-editor-title">
          {isNew ? 'Nouvelle habitude' : `Modifier : ${habit.name}`}
        </h2>
        <button type="button" className="icon-btn" aria-label="Fermer l’éditeur" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="habit-preview" aria-hidden="true">
        <span className="tile" style={{ background: color, width: 40, height: 40, borderRadius: 12 }}>
          <HabitGlyph icon={icon} size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name.trim() || 'Nom de l’habitude'}
          </div>
          <div className="small muted">
            {daysLabel(days)}
            {goal.trim() ? ` · ${goal.trim()}` : ''}
          </div>
        </div>
      </div>

      <Field label="Nom affiché sur l’écran" htmlFor="hab-name" error={errors.name}>
        <input
          id="hab-name"
          className="input"
          type="text"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
          placeholder="Boire 2 L d’eau"
        />
      </Field>

      <div className="field">
        <span className="field-label" id="hab-icon-label">
          Icône
        </span>
        <div className="icon-grid" role="radiogroup" aria-labelledby="hab-icon-label">
          {HABIT_ICONS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={icon === id}
              aria-label={ICON_NAMES[id] ?? id}
              title={ICON_NAMES[id] ?? id}
              className="icon-choice"
              style={icon === id ? { background: color } : undefined}
              onClick={() => setIcon(id)}
            >
              <HabitGlyph icon={id} size={18} />
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label" id="hab-color-label">
          Couleur
        </span>
        <div className="swatches" role="radiogroup" aria-labelledby="hab-color-label">
          {HABIT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color.toLowerCase() === c.toLowerCase()}
              aria-label={COLOR_NAMES[c] ?? c}
              title={COLOR_NAMES[c] ?? c}
              className="swatch"
              style={{ background: c }}
              onClick={() => setColor(c)}
            >
              {color.toLowerCase() === c.toLowerCase() && <Icon name="check" size={16} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <DayPicker value={days} onChange={setDays} />
        {errors.days && (
          <span className="field-error" role="alert">
            {errors.days}
          </span>
        )}
      </div>

      <Field label="Objectif" htmlFor="hab-goal" hint="Facultatif, affiché sous le nom (ex. 45 min, 20 pages).">
        <input id="hab-goal" className="input" type="text" value={goal} maxLength={30} onChange={(e) => setGoal(e.target.value)} placeholder="45 min" />
      </Field>

      <div className="field">
        <span className="field-label" id="hab-times-label">
          Rappels sur l’écran
        </span>
        <div className="row-wrap" role="group" aria-labelledby="hab-times-label" style={{ gap: 8 }}>
          {times.map((t, i) => (
            <span key={i} className="time-chip">
              <input
                className="input time"
                type="time"
                value={t}
                aria-label={`Rappel ${i + 1}`}
                onChange={(e) => setTimes((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <button
                type="button"
                className="icon-btn sm danger"
                aria-label={`Supprimer le rappel de ${t || i + 1}`}
                onClick={() => setTimes((list) => list.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={15} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="chip chip-add"
            onClick={() => setTimes((list) => [...list, list.length ? list[list.length - 1] : '09:00'])}
            disabled={times.length >= 6}
          >
            <Icon name="plus" size={14} strokeWidth={2.6} />
            Ajouter un rappel
          </button>
        </div>
        {errors.times ? (
          <span className="field-error" role="alert">
            {errors.times}
          </span>
        ) : (
          times.length === 0 && <span className="field-hint">Aucun rappel.</span>
        )}
      </div>

      <div className="setting-row" style={{ padding: 0, minHeight: 48 }}>
        <label className="setting-label" htmlFor="hab-show">
          Afficher sur l’écran
          <span className="sub">Visible dans la liste des tâches de la tablette</span>
        </label>
        <Switch id="hab-show" checked={show} onChange={setShow} label="Afficher sur l’écran" />
      </div>

      <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
        {!isNew && (
          <>
            <BusyButton className="btn btn-danger" busy={busy === 'delete'} disabled={busy !== null} onClick={() => void remove()} icon="trash">
              Supprimer
            </BusyButton>
            <BusyButton className="btn btn-outline" busy={busy === 'archive'} disabled={busy !== null} onClick={() => void archive()}>
              {habit.archived ? 'Restaurer' : 'Archiver'}
            </BusyButton>
          </>
        )}
        <span className="spacer" />
        <BusyButton type="submit" className="btn btn-primary" busy={busy === 'save'} disabled={busy !== null}>
          {isNew ? 'Créer l’habitude' : 'Enregistrer'}
        </BusyButton>
      </div>
    </form>
  );
}

// ---------- Séries, badges, historique ----------
const BADGE_TONES = ['chip-warning', 'chip-ok', 'chip-info'];

function StreakCard() {
  const toast = useToast();
  const settings = useApiData<StreakSettings>('/api/streak-settings');
  const badges = useApiData<Badge[]>('/api/badges');
  const history = useApiData<HistoryDay[]>('/api/history?days=30');
  const [draft, setDraft] = useState<StreakSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const dirty = draft && settings.data && JSON.stringify(draft) !== JSON.stringify(settings.data);

  const save = async () => {
    if (!draft) return;
    if (!isValidTime(draft.resetTime)) {
      toast.error('L’heure de remise à zéro est invalide.');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.put<StreakSettings>('/api/streak-settings', draft);
      settings.setData(saved);
      toast.success('Règles des séries enregistrées.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const unlocked = badges.data?.filter((b) => b.unlocked) ?? [];
  const locked = badges.data?.filter((b) => !b.unlocked) ?? [];

  return (
    <section className="card" aria-labelledby="streak-title" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h2 className="card-title" id="streak-title" style={{ marginBottom: 6 }}>
        Séries &amp; badges
      </h2>

      {settings.error && !draft ? (
        <ErrorState message={settings.error} onRetry={() => void settings.reload()} />
      ) : !draft ? (
        <div className="stack" style={{ gap: 10 }}>
          <Skeleton height={44} radius={10} />
          <Skeleton height={44} radius={10} />
          <Skeleton height={44} radius={10} />
        </div>
      ) : (
        <div>
          <div className="setting-row">
            <label className="setting-label" htmlFor="streak-threshold">
              Journée validée à partir de
              <span className="sub">Si moins de tâches sont prévues ce jour-là, il faut toutes les faire.</span>
            </label>
            <div className="setting-control">
              <input
                id="streak-threshold"
                className="input num"
                type="number"
                min={1}
                max={50}
                value={draft.threshold}
                onChange={(e) => setDraft({ ...draft, threshold: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span className="text-2">tâches</span>
            </div>
          </div>
          <div className="setting-row">
            <label className="setting-label" htmlFor="streak-reset">
              Remise à zéro quotidienne
            </label>
            <input
              id="streak-reset"
              className="input time"
              type="time"
              value={draft.resetTime}
              onChange={(e) => setDraft({ ...draft, resetTime: e.target.value })}
            />
          </div>
          <div className="setting-row">
            <label className="setting-label" htmlFor="streak-jokers">
              Jokers par semaine
              <span className="sub">Jours ratés tolérés sans casser la série</span>
            </label>
            <input
              id="streak-jokers"
              className="input num"
              type="number"
              min={0}
              max={7}
              value={draft.jokersPerWeek}
              onChange={(e) => setDraft({ ...draft, jokersPerWeek: Math.min(7, Math.max(0, Number(e.target.value) || 0)) })}
            />
          </div>
          {dirty && (
            <div className="row" style={{ justifyContent: 'flex-end', padding: '4px 0 10px' }}>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setDraft(settings.data)} disabled={saving}>
                Annuler
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
                {saving && <Spinner />}
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}

      <HistoryStrip data={history.data} error={history.error} />

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div className="section-label" style={{ marginBottom: 10 }}>
          Badges{badges.data ? ` · ${unlocked.length} débloqué${unlocked.length > 1 ? 's' : ''}` : ''}
        </div>
        {badges.error && !badges.data ? (
          <p className="small text-error">{badges.error}</p>
        ) : !badges.data ? (
          <div className="row-wrap">
            <Skeleton height={32} width={110} radius={16} />
            <Skeleton height={32} width={90} radius={16} />
            <Skeleton height={32} width={130} radius={16} />
          </div>
        ) : badges.data.length === 0 ? (
          <p className="small muted">Aucun badge pour l’instant.</p>
        ) : (
          <ul className="chips plain-list">
            {unlocked.map((b, i) => (
              <li key={b.id} className={`chip ${BADGE_TONES[i % BADGE_TONES.length]}`} style={{ fontWeight: 700 }}>
                <Icon name="check" size={13} strokeWidth={3} />
                {b.label}
              </li>
            ))}
            {locked.map((b) => (
              <li key={b.id} className="chip chip-locked" style={{ fontWeight: 700 }}>
                <span className="sr-only">Pas encore débloqué : </span>
                {b.label} · {b.progress}/{b.target}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function HistoryStrip({ data, error }: { data: HistoryDay[] | null; error: string | null }) {
  if (error && !data) return null;
  const days = (data ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const validated = days.filter((d) => d.validated).length;
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="section-label">30 derniers jours</span>
        {data && (
          <span className="small muted">
            {validated} journée{validated > 1 ? 's' : ''} validée{validated > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {!data ? (
        <Skeleton height={26} radius={6} />
      ) : (
        <>
          <ol className="history-strip" aria-label="Historique des 30 derniers jours">
            {days.map((d) => {
              const label = new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
              const state = d.validated ? 'validée' : d.total === 0 ? 'aucune tâche prévue' : 'non validée';
              const cls = d.validated ? 'h-ok' : d.done > 0 ? 'h-partial' : d.total === 0 ? 'h-none' : 'h-miss';
              return (
                <li key={d.date} className={`history-cell ${cls}`} title={`${label} : ${d.done}/${d.total} · ${state}`}>
                  <span className="sr-only">
                    {label} : {d.done} sur {d.total}, {state}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="history-legend" aria-hidden="true">
            <span>
              <i className="history-cell h-ok" /> Validée
            </span>
            <span>
              <i className="history-cell h-partial" /> Partielle
            </span>
            <span>
              <i className="history-cell h-miss" /> Ratée
            </span>
          </div>
        </>
      )}
    </div>
  );
}
