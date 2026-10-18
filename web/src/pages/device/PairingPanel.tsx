import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api';
import { CopyButton } from '../../components/IntegrationFields';
import { useToast } from '../../components/Toast';
import { BusyButton } from '../../components/ui';
import { Icon } from '../../icons';
import type { DeviceSummary, PairingCode } from '../../types';

const CODE_LIFETIME_S = 600;

export function useCountdown(expiresAt: string | null): number {
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

type Snapshot = Map<number, string | null>;

const snapshot = (list: DeviceSummary[]): Snapshot => new Map(list.map((d) => [d.id, d.pairedAt ?? null]));

/**
 * Associe un nouvel écran (ou ré-associe un écran existant avec `deviceId`) :
 * génère un code à 6 chiffres, l'affiche avec l'adresse du serveur, puis surveille
 * la liste des écrans jusqu'à ce que la tablette l'ait utilisé.
 */
export function PairingPanel({
  deviceId,
  autoStart = false,
  onPaired,
}: {
  deviceId?: number;
  autoStart?: boolean;
  onPaired: (device: DeviceSummary) => void;
}) {
  const toast = useToast();
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const before = useRef<Snapshot | null>(null);
  const left = useCountdown(pairing?.expiresAt ?? null);
  const expired = pairing !== null && left === 0;
  const serverUrl = window.location.origin;
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;

  const generate = async () => {
    setBusy(true);
    try {
      before.current = snapshot(await api.get<DeviceSummary[]>('/api/devices'));
      setPairing(await api.post<PairingCode>('/api/devices/pairing-code', deviceId ? { deviceId } : {}));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoStart) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pendant que le code est valable, on vérifie régulièrement si la tablette s'est associée.
  useEffect(() => {
    if (!pairing || expired) return;
    let stopped = false;
    const id = window.setInterval(async () => {
      try {
        const list = await api.get<DeviceSummary[]>('/api/devices');
        if (stopped || !before.current) return;
        const prev = before.current;
        const hit = list.find((d) =>
          deviceId !== undefined ? d.id === deviceId && d.paired && d.pairedAt !== prev.get(d.id) : !prev.has(d.id) && d.paired,
        );
        if (hit) {
          stopped = true;
          window.clearInterval(id);
          setPairing(null);
          onPairedRef.current(hit);
        }
      } catch {
        /* nouvel essai au prochain tour */
      }
    }, 4_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [pairing, expired, deviceId]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  if (pairing && !expired) {
    return (
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
          <span style={{ width: `${Math.min(100, (left / CODE_LIFETIME_S) * 100)}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="pairing-empty">
      <span className="tile lg" style={{ background: 'var(--fill)', color: 'var(--text-2)' }} aria-hidden="true">
        <Icon name="tablet" size={22} />
      </span>
      <div>
        <div style={{ fontWeight: 700 }}>
          {expired ? 'Le code a expiré' : deviceId !== undefined ? 'Ré-associer cet écran' : 'Associer un nouvel écran'}
        </div>
        <div className="small muted">
          {deviceId !== undefined
            ? 'L’écran garde son nom, ses réveils et ses réglages. L’ancien jeton cessera de fonctionner.'
            : 'Génère un code à 6 chiffres valable 10 minutes, puis saisis-le sur la tablette avec l’adresse de ce serveur.'}
        </div>
      </div>
      <BusyButton className="btn btn-primary btn-block" busy={busy} onClick={() => void generate()} icon="link">
        {expired ? 'Générer un nouveau code' : 'Générer un code'}
      </BusyButton>
    </div>
  );
}
