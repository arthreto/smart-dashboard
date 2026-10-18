import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOverview } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { ErrorState, Skeleton } from '../components/ui';
import { formatAgo, plural } from '../format';
import { useDocumentTitle, useNow } from '../hooks';
import { Icon } from '../icons';
import type { DeviceSummary } from '../types';
import { PairingPanel } from './device/PairingPanel';

export function deviceTone(d: DeviceSummary): 'ok' | 'off' | 'warning' {
  if (!d.paired) return 'warning';
  return d.online ? 'ok' : 'off';
}

export function deviceStateLabel(d: DeviceSummary, now: number): string {
  if (!d.paired) return 'Non associé';
  const parts = [d.online ? 'En ligne' : d.lastSeenAt ? `Vu ${formatAgo(d.lastSeenAt, now)}` : 'Jamais vu'];
  if (typeof d.battery === 'number') parts.push(`${d.battery} %${d.charging ? ' · en charge' : ''}`);
  return parts.join(' · ');
}

/** Ligne cliquable d'un écran (liste des écrans, vue d'ensemble). */
export function ScreenRow({ device, now }: { device: DeviceSummary; now: number }) {
  return (
    <li>
      <Link to={`/ecrans/${device.id}`} className="screen-row">
        <span className="tile" style={{ background: device.online ? 'var(--accent-strong)' : 'var(--fill)' }} aria-hidden="true">
          <Icon name="tablet" size={18} />
        </span>
        <div className="spacer" style={{ minWidth: 0 }}>
          <div className="screen-row-name">{device.name}</div>
          <div className="screen-row-sub">
            <span className={`dot dot-${deviceTone(device)}`} aria-hidden="true" />
            {deviceStateLabel(device, now)}
          </div>
        </div>
        <Icon name="chevronRight" size={18} strokeWidth={2.2} />
      </Link>
    </li>
  );
}

export function ScreensPage() {
  useDocumentTitle('Mes écrans');
  const overview = useOverview();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(15_000);
  const [adding, setAdding] = useState(false);
  const devices = overview.data?.devices;
  const online = devices?.filter((d) => d.online).length ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker">
            {devices ? `${plural(devices.length, 'écran')} · ${online} en ligne` : 'Chargement…'}
          </div>
          <h1 className="page-title">Mes écrans</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} strokeWidth={2.4} />
            Ajouter un écran
          </button>
        </div>
      </header>

      <div className="banner">
        <Icon name="info" size={22} strokeWidth={2.2} />
        <div>
          Tous tes écrans affichent les mêmes tâches, habitudes, agenda, musique et services. Chacun garde ses propres réveils,
          sa disposition, son thème, sa luminosité et sa veille.
        </div>
      </div>

      {overview.error && !devices && <ErrorState message={overview.error} onRetry={() => void overview.reload()} />}

      <section className="card" aria-label="Liste des écrans">
        {!devices ? (
          <div className="stack" style={{ gap: 10 }}>
            <Skeleton height={56} radius={12} />
            <Skeleton height={56} radius={12} />
          </div>
        ) : devices.length === 0 ? (
          <div className="empty">
            <strong>Aucun écran pour l’instant</strong>
            Ajoute ta première tablette : un code à 6 chiffres suffit.
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
              Ajouter un écran
            </button>
          </div>
        ) : (
          <ul className="screen-list">
            {devices.map((d) => (
              <ScreenRow key={d.id} device={d} now={now} />
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <Modal title="Ajouter un écran" onClose={() => setAdding(false)}>
          <PairingPanel
            autoStart
            onPaired={(d) => {
              setAdding(false);
              toast.success(`« ${d.name} » est associé.`);
              void overview.reload();
              navigate(`/ecrans/${d.id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
