import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api';
import { ReadonlyField, SecretField, TextField } from '../../components/IntegrationFields';
import { useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton, CardSkeleton, ErrorState, IconTile, Switch } from '../../components/ui';
import { useApiData, useDocumentTitle } from '../../hooks';
import { Icon } from '../../icons';
import { serviceMeta } from '../../services';
import type { AdminService, ConfigValue } from '../../types';

/** Services proposés aux foyers et identifiants d'application communs (ex. app Spotify). */
export function AdminServicesPage() {
  useDocumentTitle('Clés API & services');
  const services = useApiData<AdminService[]>('/api/admin/services');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">Administration</div>
          <h1 className="page-title">Clés API &amp; services</h1>
        </div>
      </header>

      <div className="banner">
        <Icon name="lock" size={22} strokeWidth={2.2} />
        <div>
          Les clés d’application sont communes à tout le serveur et chiffrées. Chaque foyer connecte ensuite son propre compte
          (Spotify, iCloud…) depuis sa page « Services » : tu ne vois jamais ses identifiants.
        </div>
      </div>

      {services.error && !services.data && <ErrorState message={services.error} onRetry={() => void services.reload()} />}

      <div className="grid-cards">
        {!services.data
          ? !services.error && Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} lines={3} />)
          : services.data.map((s) => (
              <ServiceCard
                key={s.id}
                service={s}
                onUpdated={(next) => services.setData((l) => l?.map((x) => (x.id === next.id ? next : x)) ?? l)}
              />
            ))}
      </div>
    </div>
  );
}

function ServiceCard({ service, onUpdated }: { service: AdminService; onUpdated: (s: AdminService) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const meta = serviceMeta(service.id);
  const [config, setConfig] = useState<Record<string, string>>(service.config);
  const [secrets, setSecrets] = useState<Record<string, string | null | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    setConfig(service.config);
    setSecrets({});
  }, [service]);

  const textFields = service.fields.filter((f) => f.type === 'text');
  const configDirty = textFields.some((f) => (config[f.key] ?? '') !== (service.config[f.key] ?? ''));
  const secretPatch = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v === null || (typeof v === 'string' && v.trim() !== '')));
  const dirty = configDirty || Object.keys(secretPatch).length > 0;

  const toggleAvailable = async (available: boolean) => {
    if (!available) {
      const yes = await confirm({
        title: `Masquer ${service.name} pour les foyers ?`,
        message: 'Le service disparaît de la console et des écrans de tous les foyers. Leurs réglages sont conservés si tu le réactives.',
        confirmLabel: 'Masquer',
        danger: true,
      });
      if (!yes) return;
    }
    setToggling(true);
    try {
      onUpdated(await api.put<AdminService>(`/api/admin/services/${service.id}`, { available }));
      toast.success(available ? `${service.name} est proposé aux foyers.` : `${service.name} est masqué.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  const save = async () => {
    const idChanged = service.id === 'spotify' && (config.clientId ?? '') !== (service.config.clientId ?? '') && !!service.config.clientId;
    if (idChanged) {
      const yes = await confirm({
        title: 'Changer d’application Spotify ?',
        message: 'Les comptes Spotify déjà connectés par les foyers ne fonctionneront plus : chacun devra reconnecter le sien.',
        confirmLabel: 'Changer d’application',
        danger: true,
      });
      if (!yes) return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (configDirty) body.config = Object.fromEntries(textFields.map((f) => [f.key, (config[f.key] ?? '').trim()]));
      if (Object.keys(secretPatch).length) body.secrets = secretPatch;
      onUpdated(await api.put<AdminService>(`/api/admin/services/${service.id}`, body));
      toast.success(`Identifiants de ${service.name} enregistrés.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const status = !service.available
    ? { label: 'MASQUÉ', cls: 'pill pill-dot' }
    : service.configured
      ? { label: 'PRÊT', cls: 'pill pill-ok pill-dot' }
      : { label: 'À CONFIGURER', cls: 'pill pill-warning pill-dot' };

  return (
    <section className="card flex-col" aria-labelledby={`svc-${service.id}`}>
      <div className="card-head">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <IconTile icon={meta.icon} color={service.available ? meta.color : '#3A3A41'} />
          <h2 className="card-title" id={`svc-${service.id}`}>
            {service.name}
          </h2>
        </div>
        <span className={status.cls}>{status.label}</span>
      </div>
      <p className="text-2" style={{ fontSize: 14, lineHeight: 1.45 }}>
        {service.description}
      </p>

      <div className="setting-row">
        <label className="setting-label" htmlFor={`svc-av-${service.id}`}>
          Proposer aux foyers
          <span className="sub">{service.available ? 'Visible dans la page « Services » de chaque foyer' : 'Masqué partout'}</span>
        </label>
        <div className="setting-control">
          <Switch
            id={`svc-av-${service.id}`}
            checked={service.available}
            disabled={toggling}
            onChange={(v) => void toggleAvailable(v)}
            label={`Proposer ${service.name} aux foyers`}
          />
        </div>
      </div>

      {service.fields.length > 0 && (
        <div className="stack" style={{ gap: 14 }}>
          {service.fields.map((f) => {
            const id = `svc-${service.id}-${f.key}`;
            return (
              <div className="field" key={f.key}>
                <label className="field-label" htmlFor={id}>
                  {f.label}
                </label>
                {f.type === 'secret' ? (
                  <SecretField
                    integrationId={service.id}
                    revealPath={`/api/admin/services/${service.id}/secret/${f.key}`}
                    field={f}
                    state={service.secrets[f.key]}
                    draft={secrets[f.key]}
                    onDraft={(v) => setSecrets((s) => ({ ...s, [f.key]: v }))}
                    id={id}
                  />
                ) : f.type === 'readonly' ? (
                  <ReadonlyField field={f} value={service.config[f.key] ?? ''} id={id} />
                ) : (
                  <TextField
                    field={f}
                    value={config[f.key] ?? ''}
                    onChange={(v: ConfigValue) => setConfig((c) => ({ ...c, [f.key]: v === null || v === undefined ? '' : String(v) }))}
                    id={id}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {service.missing && service.available && (
        <p className="small text-warning" role="note">
          {service.missing}
        </p>
      )}

      {service.help && (
        <div className="inset small text-2" style={{ lineHeight: 1.5 }}>
          {service.help}
        </div>
      )}

      {service.fields.some((f) => f.type !== 'readonly') && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'auto' }}>
          <BusyButton className="btn btn-primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
            Enregistrer
          </BusyButton>
        </div>
      )}
    </section>
  );
}
