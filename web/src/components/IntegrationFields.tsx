// Contrôles génériques pour les champs d'intégration (fields[].type de l'API).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { copyText } from '../hooks';
import { Icon } from '../icons';
import type { ConfigValue, ICloudCalendar, IntegrationField, PatheCinema, SecretState } from '../types';
import { useToast } from './Toast';
import { Spinner } from './ui';

// ---------- Bouton copier ----------
export function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Copier ${label}`}
      title="Copier"
      disabled={!value}
      onClick={async () => {
        const ok = await copyText(value);
        if (ok) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } else {
          toast.error('Copie impossible. Sélectionne le texte manuellement.');
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={18} />
    </button>
  );
}

export function asString(v: ConfigValue): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export function asStringArray(v: ConfigValue): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string' && v) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

// ---------- Lecture seule ----------
export function ReadonlyField({ field, value, id }: { field: IntegrationField; value: ConfigValue; id: string }) {
  const text = asString(value);
  return (
    <div className="value-box" id={id} aria-readonly="true">
      <span className={['value', field.mono ? 'mono' : '', text ? '' : 'placeholder'].join(' ')} title={text}>
        {text || 'Non renseigné'}
      </span>
      {field.copyable && text && <CopyButton value={text} label={field.label} />}
    </div>
  );
}

// ---------- Texte / nombre ----------
export function TextField({
  field,
  value,
  onChange,
  id,
  type = 'text',
}: {
  field: IntegrationField;
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  id: string;
  type?: 'text' | 'number';
}) {
  const text = asString(value);
  return (
    <div className="value-box">
      <input
        id={id}
        className={field.mono ? 'value-box-input mono' : 'value-box-input'}
        type={type}
        inputMode={type === 'number' ? 'numeric' : undefined}
        min={field.min}
        max={field.max}
        value={text}
        placeholder={field.placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          if (type === 'number') {
            const raw = e.target.value;
            onChange(raw === '' ? null : Number(raw));
          } else {
            onChange(e.target.value);
          }
        }}
      />
      {field.copyable && text && <CopyButton value={text} label={field.label} />}
    </div>
  );
}

// ---------- Secret ----------
/**
 * Aperçu masqué ; l'œil révèle la valeur (GET journalisé côté serveur) ; « Modifier » ouvre la saisie.
 * `draft` : undefined = inchangé, string = nouvelle valeur, null = à effacer.
 */
export function SecretField({
  integrationId,
  field,
  state,
  draft,
  onDraft,
  id,
}: {
  integrationId: string;
  field: IntegrationField;
  state: SecretState | undefined;
  draft: string | null | undefined;
  onDraft: (v: string | null | undefined) => void;
  id: string;
}) {
  const toast = useToast();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTyped, setShowTyped] = useState(false);
  const isSet = Boolean(state?.set);
  const editing = draft !== undefined;

  // Une fois la valeur enregistrée (nouvel aperçu), on oublie la valeur révélée.
  useEffect(() => {
    setRevealed(null);
  }, [state?.preview, state?.set]);

  const reveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<{ value: string }>(
        `/api/integrations/${encodeURIComponent(integrationId)}/secret/${encodeURIComponent(field.key)}`,
      );
      setRevealed(res.value ?? '');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (editing) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        {draft === null ? (
          <div className="value-box">
            <span className="value placeholder">La valeur sera effacée à l’enregistrement</span>
          </div>
        ) : (
          <div className="value-box">
            <input
              id={id}
              className="value-box-input mono"
              type={showTyped ? 'text' : 'password'}
              value={draft}
              placeholder={isSet ? 'Nouvelle valeur' : 'Colle la valeur ici'}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(e) => onDraft(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={showTyped ? `Masquer la saisie de ${field.label}` : `Afficher la saisie de ${field.label}`}
              aria-pressed={showTyped}
              onClick={() => setShowTyped((v) => !v)}
            >
              <Icon name={showTyped ? 'eyeOff' : 'eye'} size={19} />
            </button>
          </div>
        )}
        <div className="row-wrap" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => onDraft(undefined)}>
            Annuler la modification
          </button>
          {isSet && draft !== null && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onDraft(null)}>
              Effacer la valeur
            </button>
          )}
        </div>
      </div>
    );
  }

  const display = revealed !== null ? revealed : isSet ? state?.preview || '••••••••••••' : '';
  return (
    <div className="value-box" id={id}>
      <span
        className={['value', 'mono', display ? '' : 'placeholder'].join(' ')}
        aria-label={revealed !== null ? undefined : isSet ? `${field.label} masqué` : undefined}
      >
        {display || 'Non défini'}
      </span>
      {isSet && (
        <button
          type="button"
          className="icon-btn"
          aria-label={revealed !== null ? `Masquer ${field.label}` : `Afficher ${field.label}`}
          aria-pressed={revealed !== null}
          onClick={() => void reveal()}
          disabled={loading}
        >
          {loading ? <Spinner /> : <Icon name={revealed !== null ? 'eyeOff' : 'eye'} size={19} />}
        </button>
      )}
      {revealed !== null && <CopyButton value={revealed} label={field.label} />}
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => {
          setRevealed(null);
          onDraft('');
        }}
        aria-label={`${isSet ? 'Modifier' : 'Saisir'} ${field.label}`}
      >
        {isSet ? 'Modifier' : 'Saisir'}
      </button>
    </div>
  );
}

// ---------- Liste déroulante ----------
export function SelectField({
  field,
  value,
  onChange,
  id,
}: {
  field: IntegrationField;
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  id: string;
}) {
  const current = asString(value);
  const options = field.options ?? [];
  const known = options.some((o) => o.value === current);
  return (
    <select id={id} className="select" value={current} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={current}>{current ? current : 'Choisir…'}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- Liste d'heures ----------
export function TimeListField({
  field,
  value,
  onChange,
  id,
}: {
  field: IntegrationField;
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  id: string;
}) {
  const times = asStringArray(value);
  return (
    <div className="row-wrap" style={{ gap: 8 }} role="group" aria-labelledby={`${id}-label`}>
      {times.map((t, i) => (
        <span key={i} className="time-chip">
          <input
            id={i === 0 ? id : undefined}
            className="input time"
            type="time"
            value={t}
            aria-label={`${field.label} ${i + 1}`}
            onChange={(e) => {
              const next = times.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="icon-btn sm danger"
            aria-label={`Retirer l’heure ${t || i + 1}`}
            onClick={() => onChange(times.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={15} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="chip chip-add"
        onClick={() => onChange([...times, times.length ? times[times.length - 1] : '08:00'])}
      >
        <Icon name="plus" size={14} strokeWidth={2.6} />
        Ajouter une heure
      </button>
    </div>
  );
}

// ---------- Jetons ----------
export function ChipsField({
  field,
  value,
  onChange,
  id,
}: {
  field: IntegrationField;
  value: ConfigValue;
  onChange?: (v: ConfigValue) => void;
  id: string;
}) {
  const selected = asStringArray(value);
  if (field.options && field.options.length && onChange) {
    return (
      <div className="chips" role="group" aria-labelledby={`${id}-label`} id={id}>
        {field.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className="chip sm"
              role="checkbox"
              aria-checked={on}
              onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
            >
              {on && <Icon name="check" size={14} strokeWidth={2.6} />}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  if (selected.length === 0) return <span className="field-hint">Aucun élément</span>;
  return (
    <ul className="chips plain-list" id={id}>
      {selected.map((label) => (
        <li key={label} className="chip sm">
          {label}
        </li>
      ))}
    </ul>
  );
}

// ---------- Pathé : sélection de cinéma avec recherche ----------
export function CinemaPicker({
  value,
  onChange,
  id,
  label,
  nameHint,
}: {
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  id: string;
  label: string;
  nameHint?: string;
}) {
  const [cinemas, setCinemas] = useState<PatheCinema[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = asString(value);

  const load = async () => {
    setError(null);
    try {
      setCinemas(await api.get<PatheCinema[]>('/api/integrations/pathe/cinemas'));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = cinemas?.find((c) => String(c.id) === current);
  const selectedLabel = selected ? `${selected.name}${selected.city ? ` · ${selected.city}` : ''}` : nameHint || current;

  const results = useMemo(() => {
    if (!cinemas) return [];
    const q = query
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
    const list = q ? cinemas.filter((c) => norm(`${c.name} ${c.city ?? ''}`).includes(q)) : cinemas;
    return list.slice(0, 50);
  }, [cinemas, query]);

  const choose = (c: PatheCinema) => {
    onChange(String(c.id));
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="combo" ref={wrapRef}>
      <div className="value-box">
        <Icon name="search" size={17} className="muted" />
        <input
          id={id}
          className="value-box-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-label={`${label} : rechercher`}
          placeholder={selectedLabel || 'Rechercher un cinéma (nom ou ville)'}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              if (open && results[active]) {
                e.preventDefault();
                choose(results[active]);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          autoComplete="off"
        />
        {!cinemas && !error && <Spinner />}
      </div>
      {selectedLabel && (
        <span className="field-hint">
          Sélectionné : <strong className="text-2">{selectedLabel}</strong>
        </span>
      )}
      {error && (
        <span className="field-error">
          {error}{' '}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}>
            Réessayer
          </button>
        </span>
      )}
      {open && cinemas && (
        <ul className="combo-list" role="listbox" id={listId} aria-label="Cinémas">
          {results.length === 0 ? (
            <li className="combo-empty">Aucun cinéma ne correspond.</li>
          ) : (
            results.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={String(c.id) === current}
                className={i === active ? 'combo-option active' : 'combo-option'}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
              >
                <span>{c.name}</span>
                {c.city && <span className="muted small">{c.city}</span>}
                {String(c.id) === current && <Icon name="check" size={16} className="text-ok" />}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ---------- iCloud : choix des calendriers ----------
export function CalendarPicker({
  value,
  onChange,
  ready,
  id,
}: {
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  /** Identifiants enregistrés côté serveur ? */
  ready: boolean;
  id: string;
}) {
  const [calendars, setCalendars] = useState<ICloudCalendar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = asStringArray(value);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setCalendars(await api.get<ICloudCalendar[]>('/api/integrations/icloud/calendars'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <span className="field-hint" id={id}>
        Enregistre d’abord ton identifiant Apple et ton mot de passe pour app, puis choisis les calendriers à afficher.
      </span>
    );
  }

  if (!calendars) {
    return (
      <div className="row-wrap" id={id}>
        <span className="field-hint spacer">
          {selected.length === 0
            ? 'Aucun calendrier choisi : tous les calendriers seront affichés.'
            : `${selected.length} calendrier${selected.length > 1 ? 's' : ''} sélectionné${selected.length > 1 ? 's' : ''}.`}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : <Icon name="calendar" size={16} />}
          Choisir les calendriers
        </button>
        {error && <span className="field-error" style={{ flexBasis: '100%' }}>{error}</span>}
      </div>
    );
  }

  if (calendars.length === 0) return <span className="field-hint">Aucun calendrier trouvé sur ce compte iCloud.</span>;

  return (
    <div className="chips" role="group" aria-labelledby={`${id}-label`} id={id}>
      {calendars.map((c) => {
        const on = selected.includes(String(c.id));
        return (
          <button
            key={c.id}
            type="button"
            className="chip"
            role="checkbox"
            aria-checked={on}
            onClick={() => onChange(on ? selected.filter((v) => v !== String(c.id)) : [...selected, String(c.id)])}
          >
            <span className="cal-dot" style={{ background: c.color || '#8B8B94' }} aria-hidden="true" />
            {c.name}
            {on && <Icon name="check" size={14} strokeWidth={2.6} />}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Roblox : retrouver l'Universe ID depuis l'ID de place ----------
export function RobloxResolver({ onResolved }: { onResolved: (universeId: string, name: string) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [placeId, setPlaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        J’ai seulement l’ID de la place
      </button>
    );
  }

  const resolve = async () => {
    const id = placeId.trim();
    if (!/^\d+$/.test(id)) {
      toast.error('L’ID de la place ne contient que des chiffres (visible dans l’URL du jeu).');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ universeId: number | string; name: string }>('/api/integrations/roblox/resolve', {
        placeId: id,
      });
      onResolved(String(res.universeId), res.name);
      toast.success(`Jeu trouvé : ${res.name}. Pense à enregistrer.`);
      setOpen(false);
      setPlaceId('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inset stack" style={{ gap: 10 }}>
      <label className="field-label" htmlFor={inputId}>
        ID de la place (dans l’URL roblox.com/games/<strong>123456</strong>/…)
      </label>
      <div className="row">
        <input
          id={inputId}
          className="input mono"
          inputMode="numeric"
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void resolve();
            }
          }}
          placeholder="123456789"
          autoFocus
        />
        <button type="button" className="btn btn-primary" onClick={() => void resolve()} disabled={busy || !placeId}>
          {busy ? <Spinner /> : null}
          Trouver
        </button>
        <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => setOpen(false)}>
          <Icon name="x" size={17} />
        </button>
      </div>
    </div>
  );
}
