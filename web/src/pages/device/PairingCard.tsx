import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api';
import { CopyButton } from '../../components/IntegrationFields';
import { useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton, SettingRow } from '../../components/ui';
import { formatAgo } from '../../format';
import { useNow } from '../../hooks';
import { Icon } from '../../icons';
import type { DeviceInfo, PairingCode } from '../../types';

function useCountdown(expiresAt: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const end = new Date(expiresAt).getTime();
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return left;
}

export function PairingCard({ device, reload }: { device: DeviceInfo; reload: () => Promise<void> }) {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(15_000);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState<'code' | 'token' | 'unpair' | null>(null);
  const left = useCountdown(pairing?.expiresAt ?? null);
  const expired = pairing !== null && left === 0;
  const serverUrl = window.location.origin;

  // Pendant l'appairage, on vérifie régulièrement si la tablette s'est associée.
  useEffect(() => {
    if (!pairing || expired || device.paired) return;
    const id = window.setInterval(() => void reload(), 4_000);
    return () => window.clearInterval(id);
  }, [pairing, expired, device.paired, reload]);

  useEffect(() => {
    if (device.paired && pairing) {
      setPairing(null);
      toast.success('Tablette associée !');
    }
  }, [device.paired, pairing, toast]);

  const generate = async () => {
    setBusy('code');
    try {
      setPairing(await api.post<PairingCode>('/api/device/pairing-code'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    const yes = await confirm({
      title: 'Régénérer le jeton de la tablette ?',
      message: 'Le jeton actuel cessera immédiatement de fonctionner. Tu devras ré-associer la tablette avec un nouveau code.',
      confirmLabel: 'Régénérer le jeton',
      danger: true,
    });
    if (!yes) return;
    setBusy('token');
    try {
      await api.post('/api/device/regenerate-token');
      toast.success('Jeton régénéré. Associe de nouveau la tablette.');
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const unpair = async () => {
    const yes = await confirm({
      title: 'Désappairer la tablette ?',
      message: 'La tablette ne recevra plus aucune donnée tant qu’elle ne sera pas associée de nouveau.',
      confirmLabel: 'Désappairer',
      danger: true,
    });
    if (!yes) return;
    setBusy('unpair');
    try {
      await api.del('/api/device');
      toast.success('Tablette désappairée.');
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <section className="card" aria-labelledby="pairing-title">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2 className="card-title" id="pairing-title">
          Appairage
        </h2>
        {device.paired && (
          <span className={device.online ? 'pill pill-ok pill-dot' : 'pill pill-dot'}>{device.online ? 'EN LIGNE' : 'HORS LIGNE'}</span>
        )}
      </div>

      {device.paired ? (
        <>
          <div className="divided">
            <SettingRow label="Appareil">
              <span style={{ fontWeight: 700 }}>{device.name || 'Tablette'}</span>
            </SettingRow>
            <SettingRow label="Firmware">
              <span className="mono">{device.firmware || '—'}</span>
            </SettingRow>
            <SettingRow label="Dernier contact">
              <span style={{ fontWeight: 700 }}>{device.lastSeenAt ? formatAgo(device.lastSeenAt, now) : 'Jamais'}</span>
            </SettingRow>
            {(device.ip || typeof device.rssi === 'number') && (
              <SettingRow label="Réseau">
                <span className="text-2">
                  {device.ip && <span className="mono">{device.ip}</span>}
                  {device.ip && typeof device.rssi === 'number' ? ' · ' : ''}
                  {typeof device.rssi === 'number' ? `Wi-Fi ${device.rssi} dBm` : ''}
                </span>
              </SettingRow>
            )}
          </div>
          <div className="row-wrap" style={{ marginTop: 12 }}>
            <BusyButton className="btn btn-outline btn-grow" busy={busy === 'token'} disabled={busy !== null} onClick={() => void regenerate()}>
              Régénérer le jeton
            </BusyButton>
            <BusyButton className="btn btn-danger btn-grow" busy={busy === 'unpair'} disabled={busy !== null} onClick={() => void unpair()}>
              Désappairer
            </BusyButton>
          </div>
        </>
      ) : pairing && !expired ? (
        <div className="pairing">
          <p className="text-2">Sur la tablette, choisis « Associer » puis saisis :</p>
          <div className="pairing-steps">
            <div className="field">
              <span className="field-label">Adresse du serveur</span>
              <div className="value-box">
                <span className="value mono">{serverUrl}</span>
                <CopyButton value={serverUrl} label="l’adresse du serveur" />
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="pairing-code-label">
                Code d’appairage
              </span>
              <div className="pairing-code mono" aria-labelledby="pairing-code-label" aria-live="polite">
                {pairing.code.split('').map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted" role="timer" aria-live="off">
              Expire dans {mm}:{ss}
            </span>
            <span className="small muted row" style={{ gap: 8 }}>
              <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14, borderWidth: 2 }} />
              En attente de la tablette…
            </span>
          </div>
          <div className="progress thin blue" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (left / 600) * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className="pairing-empty">
          <span className="tile lg" style={{ background: '#26262C', color: 'var(--text-2)' }} aria-hidden="true">
            <Icon name="tablet" size={22} />
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>{expired ? 'Le code a expiré' : 'Aucune tablette associée'}</div>
            <div className="small muted">
              Génère un code à 6 chiffres valable 10 minutes, puis saisis-le sur la tablette avec l’adresse de ce serveur.
            </div>
          </div>
          <BusyButton className="btn btn-primary btn-block" busy={busy === 'code'} onClick={() => void generate()} icon="link">
            {expired ? 'Générer un nouveau code' : 'Associer une tablette'}
          </BusyButton>
        </div>
      )}
    </section>
  );
}
