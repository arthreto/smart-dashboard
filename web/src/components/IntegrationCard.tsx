import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../api';
import { formatAgo } from '../format';
import { useNow } from '../hooks';
import { Icon } from '../icons';
import { serviceMeta } from '../services';
import type { ConfigValue, Integration, IntegrationAction, IntegrationField, IntegrationUpdate, TestResult } from '../types';
import {
  asString,
  CalendarPicker,
  ChipsField,
  CinemaPicker,
  ReadonlyField,
  RobloxResolver,
  SecretField,
  SelectField,
  TextField,
  TimeListField,
} from './IntegrationFields';
import { useToast } from './Toast';
import { IconTile, Spinner, StatusPill, Switch } from './ui';

interface Props {
  integration: Integration;
  onUpdated: (next: Integration) => void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isCinemaField = (integrationId: string, f: IntegrationField) =>
  integrationId === 'pathe' && /^cinema(Id|Slug)?$/i.test(f.key) && f.type !== 'readonly' && f.type !== 'chips';
const isUniverseField = (integrationId: string, f: IntegrationField) =>
  integrationId === 'roblox' && /^universeId$/i.test(f.key) && f.type !== 'readonly';
const isCalendarsField = (integrationId: string, f: IntegrationField) => integrationId === 'icloud' && f.key === 'calendars';

export function IntegrationCard({ integration, onUpdated }: Props) {
  const toast = useToast();
  const now = useNow(30_000);
  const meta = serviceMeta(integration.id);
  const [changes, setChanges] = useState<Record<string, ConfigValue>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string | null | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);

  const valueOf = (key: string): ConfigValue => (key in changes ? changes[key] : integration.config[key]);

  const setValue = (key: string, v: ConfigValue) => {
    setTest(null);
    setChanges((c) => {
      const next = { ...c };
      if (same(v, integration.config[key])) delete next[key];
      else next[key] = v;
      return next;
    });
  };

  const setSecretDraft = (key: string, v: string | null | undefined) => {
    setTest(null);
    setSecretDrafts((d) => {
      const next = { ...d };
      if (v === undefined) delete next[key];
      else next[key] = v;
      return next;
    });
  };

  // Secrets réellement à envoyer : une valeur non vide, ou null pour effacer.
  const secretPayload = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(secretDrafts)) {
      if (v === null) out[k] = null;
      else if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
    }
    return out;
  }, [secretDrafts]);

  const dirty = Object.keys(changes).length > 0 || Object.keys(secretPayload).length > 0;

  // Le résultat du test s'efface après un moment.
  useEffect(() => {
    if (!test) return;
    const id = window.setTimeout(() => setTest(null), test.ok ? 8_000 : 15_000);
    return () => window.clearTimeout(id);
  }, [test]);

  const save = async () => {
    const body: IntegrationUpdate = {};
    if (Object.keys(changes).length) body.config = changes;
    if (Object.keys(secretPayload).length) body.secrets = secretPayload;
    if (!body.config && !body.secrets) return;
    setSaving(true);
    try {
      const next = await api.put<Integration>(`/api/integrations/${encodeURIComponent(integration.id)}`, body);
      setChanges({});
      setSecretDrafts({});
      onUpdated(next);
      toast.success(`${integration.name} : modifications enregistrées.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setChanges({});
    setSecretDrafts({});
    setResolvedName(null);
  };

  const toggleEnabled = async (enabled: boolean) => {
    setToggling(true);
    try {
      const next = await api.put<Integration>(`/api/integrations/${encodeURIComponent(integration.id)}`, { enabled });
      onUpdated(next);
      toast.success(`${integration.name} ${enabled ? 'activé' : 'désactivé'}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<TestResult>(`/api/integrations/${encodeURIComponent(integration.id)}/test`));
    } catch (err) {
      setTest({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.post(`/api/integrations/${encodeURIComponent(integration.id)}/refresh`);
      toast.success(`${integration.name} : mise à jour lancée.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const runAction = (action: IntegrationAction) => {
    if (action.id === 'connect' && integration.id === 'spotify') {
      if (dirty) {
        toast.info('Enregistre d’abord tes modifications, puis connecte le compte.');
        return;
      }
      window.location.href = '/api/integrations/spotify/connect';
      return;
    }
    if (action.id === 'refresh') {
      void refresh();
      return;
    }
    if (action.id === 'test') {
      void runTest();
    }
  };

  // Identifiants iCloud enregistrés (requis pour lister les calendriers).
  const credentialsReady =
    Object.values(integration.secrets ?? {}).every((s) => s.set) &&
    Object.keys(secretPayload).length === 0 &&
    Object.keys(changes).every((k) => k === 'calendars');

  const hasCalendarsField = integration.fields.some((f) => isCalendarsField(integration.id, f));

  const renderControl = (f: IntegrationField, id: string): ReactNode => {
    if (isCalendarsField(integration.id, f)) {
      return <CalendarPicker id={id} value={valueOf(f.key)} onChange={(v) => setValue(f.key, v)} ready={credentialsReady} />;
    }
    if (isCinemaField(integration.id, f)) {
      return (
        <CinemaPicker
          id={id}
          label={f.label}
          value={valueOf(f.key)}
          onChange={(v) => setValue(f.key, v)}
          nameHint={asString(integration.config.cinemaName) || undefined}
        />
      );
    }
    switch (f.type) {
      case 'readonly':
        return <ReadonlyField id={id} field={f} value={valueOf(f.key)} />;
      case 'secret':
        return (
          <SecretField
            id={id}
            integrationId={integration.id}
            field={f}
            state={integration.secrets?.[f.key]}
            draft={secretDrafts[f.key]}
            onDraft={(v) => setSecretDraft(f.key, v)}
          />
        );
      case 'number':
        return <TextField id={id} field={f} type="number" value={valueOf(f.key)} onChange={(v) => setValue(f.key, v)} />;
      case 'select':
        return <SelectField id={id} field={f} value={valueOf(f.key)} onChange={(v) => setValue(f.key, v)} />;
      case 'time-list':
        return <TimeListField id={id} field={f} value={valueOf(f.key)} onChange={(v) => setValue(f.key, v)} />;
      case 'chips':
        return <ChipsField id={id} field={f} value={valueOf(f.key)} onChange={(v) => setValue(f.key, v)} />;
      case 'text':
      default:
        return <TextField id={id} field={f} value={valueOf(f.key)} onChange={(v) => setValue(f.key, v)} />;
    }
  };

  const pillStatus = integration.enabled ? integration.status : 'disabled';
  const pillLabel = integration.enabled ? integration.statusDetail || undefined : 'Désactivé';
  const supportedActions = integration.actions.filter(
    (a) => (a.id === 'connect' && integration.id === 'spotify') || a.id === 'refresh' || a.id === 'test',
  );
  const otherActions = integration.actions.filter((a) => !supportedActions.includes(a));

  const testClass = test ? (test.ok ? 'btn btn-success btn-grow' : 'btn btn-error btn-grow') : 'btn btn-grow';
  const testLabel = testing
    ? 'Test en cours…'
    : test
      ? test.ok
        ? `Connexion réussie${typeof test.ms === 'number' ? ` · ${Math.round(test.ms)} ms` : ''}`
        : 'Échec de la connexion'
      : 'Tester la connexion';

  const headingId = `integ-${integration.id}-title`;

  return (
    <section className="card integration-card" aria-labelledby={headingId}>
      <div className="integration-head">
        <IconTile icon={meta.icon} color={integration.enabled ? meta.color : '#3A3A41'} size="lg" />
        <div className="spacer" style={{ minWidth: 0 }}>
          <h2 className="card-title" id={headingId}>
            {integration.name}
          </h2>
          <div className="muted" style={{ fontSize: 14 }}>
            {integration.description}
          </div>
        </div>
        <StatusPill status={pillStatus} label={pillLabel} large dot />
      </div>

      <div className="setting-row compact">
        <label className="setting-label" htmlFor={`integ-${integration.id}-enabled`}>
          Intégration activée
          <span className="sub">
            {integration.lastRunAt ? `Dernière mise à jour ${formatAgo(integration.lastRunAt, now)}` : 'Jamais exécutée'}
          </span>
        </label>
        <div className="setting-control">
          {integration.enabled && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Relancer ${integration.name} maintenant`}
              title="Relancer maintenant"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? <Spinner /> : <Icon name="sync" size={18} />}
            </button>
          )}
          {toggling && <Spinner />}
          <Switch
            id={`integ-${integration.id}-enabled`}
            checked={integration.enabled}
            onChange={(v) => void toggleEnabled(v)}
            label={`Activer ${integration.name}`}
            disabled={toggling}
          />
        </div>
      </div>

      {integration.fields.map((f) => {
        const id = `integ-${integration.id}-${f.key}`;
        const labelled = f.type === 'readonly' || f.type === 'chips' || f.type === 'time-list' || isCalendarsField(integration.id, f);
        return (
          <div className="field" key={f.key}>
            {labelled ? (
              <span className="field-label" id={`${id}-label`}>
                {f.label}
              </span>
            ) : (
              <label className="field-label" htmlFor={id} id={`${id}-label`}>
                {f.label}
              </label>
            )}
            {renderControl(f, id)}
            {f.help && <span className="field-hint">{f.help}</span>}
            {isUniverseField(integration.id, f) && (
              <>
                {resolvedName && <span className="field-hint">Jeu : {resolvedName}</span>}
                <RobloxResolver
                  onResolved={(universeId, name) => {
                    setValue(f.key, /^\d+$/.test(universeId) && typeof integration.config[f.key] === 'number' ? Number(universeId) : universeId);
                    setResolvedName(name);
                  }}
                />
              </>
            )}
          </div>
        );
      })}

      {integration.id === 'icloud' && !hasCalendarsField && (
        <div className="field">
          <span className="field-label" id={`integ-icloud-calendars-label`}>
            Calendriers affichés
          </span>
          <CalendarPicker
            id="integ-icloud-calendars"
            value={valueOf('calendars')}
            onChange={(v) => setValue('calendars', v)}
            ready={credentialsReady}
          />
        </div>
      )}

      <div className="spacer" />

      {test && !test.ok && (
        <div className="banner error" role="alert" style={{ padding: '12px 14px', fontSize: 14 }}>
          <Icon name="alert" size={18} />
          <div>{test.message || 'La connexion a échoué.'}</div>
        </div>
      )}
      {test && test.ok && test.message && (
        <p className="small text-ok" role="status">
          {test.message}
        </p>
      )}

      <div className="row-wrap integration-actions">
        <button type="button" className={testClass} onClick={() => void runTest()} disabled={testing} aria-live="polite">
          {testing ? <Spinner /> : test?.ok ? <Icon name="check" size={17} strokeWidth={2.4} /> : null}
          {testLabel}
        </button>
        {supportedActions
          .filter((a) => a.id !== 'test')
          .map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn btn-outline btn-grow"
              onClick={() => runAction(a)}
              disabled={a.id === 'refresh' && refreshing}
            >
              {a.id === 'connect' && <Icon name="link" size={17} />}
              {a.label}
            </button>
          ))}
        {otherActions.map((a) => (
          <button key={a.id} type="button" className="btn btn-outline btn-grow" disabled title="Action non prise en charge par cette console">
            {a.label}
          </button>
        ))}
      </div>

      <div className={dirty ? 'save-bar dirty' : 'save-bar'}>
        <span className="small spacer" aria-live="polite">
          {dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}
        </span>
        {dirty && (
          <button type="button" className="btn btn-sm btn-outline" onClick={discard} disabled={saving}>
            Annuler
          </button>
        )}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving && <Spinner />}
          Enregistrer
        </button>
      </div>
    </section>
  );
}
