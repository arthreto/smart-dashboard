import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api';
import { MessageModal } from '../../components/MessageModal';
import { useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton } from '../../components/ui';
import { formatAgo, formatTime } from '../../format';
import { useNow } from '../../hooks';
import { Icon } from '../../icons';
import type { DeviceCommandType, DeviceInfo } from '../../types';

const POLL_EVERY_MS = 5_000;
const POLL_ATTEMPTS = 18; // ≈ 90 s : la tablette récupère la commande à sa prochaine synchro

const COMMAND_TOASTS: Record<DeviceCommandType, string> = {
  wake: 'Réveil de l’écran demandé.',
  lock: 'Verrouillage demandé.',
  reboot: 'Redémarrage demandé.',
  message: 'Message envoyé à l’écran.',
  reload: 'Rechargement demandé.',
  screenshot: 'Capture demandée.',
};

/** Capture en direct et télécommande d'un écran. */
export function ScreenRemoteCard({ device }: { device: DeviceInfo }) {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(5_000);
  const shotUrl = `/api/devices/${device.id}/screenshot.jpg`;
  const [stamp, setStamp] = useState(() => Date.now());
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const [pending, setPending] = useState<DeviceCommandType | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const cancelled = useRef(false);
  const paired = device.paired;

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const sendCommand = useCallback(
    async (type: DeviceCommandType, text?: string): Promise<boolean> => {
      try {
        await api.post<{ id: number }>(`/api/devices/${device.id}/commands`, text !== undefined ? { type, text } : { type });
        toast.success(
          `${COMMAND_TOASTS[type]} ${device.online ? 'Elle sera appliquée à la prochaine synchro de l’écran.' : 'L’écran l’appliquera dès qu’il sera de nouveau en ligne.'}`,
        );
        return true;
      } catch (err) {
        toast.error(errorMessage(err));
        return false;
      }
    },
    [device.id, device.online, toast],
  );

  /** Interroge l'en-tête de la capture (HEAD) pour savoir si une nouvelle image est arrivée. */
  const probe = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(shotUrl, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 404) return 'none';
      if (!res.ok) return null;
      const lm = res.headers.get('last-modified');
      if (lm) setCapturedAt(lm);
      return [res.headers.get('etag'), lm, res.headers.get('content-length')].join('|');
    } catch {
      return null;
    }
  }, [shotUrl]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const reloadImage = () => {
    setMissing(false);
    setStamp(Date.now());
  };

  const requestCapture = async () => {
    setPending('screenshot');
    const before = await probe();
    const ok = await sendCommand('screenshot');
    setPending(null);
    if (!ok) return;
    setPolling(true);
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => window.setTimeout(r, POLL_EVERY_MS));
      if (cancelled.current) return;
      const sig = await probe();
      if (cancelled.current) return;
      if (sig === '||') {
        // Pas d'en-têtes exploitables : on recharge simplement l'image.
        reloadImage();
        continue;
      }
      if (sig && sig !== 'none' && sig !== before) {
        reloadImage();
        setPolling(false);
        toast.success('Nouvelle capture reçue.');
        return;
      }
    }
    setPolling(false);
    if (!cancelled.current) toast.info('Pas encore de nouvelle capture. L’écran est peut-être en veille profonde.');
  };

  const run = async (type: DeviceCommandType) => {
    if (type === 'reboot') {
      const yes = await confirm({
        title: `Redémarrer « ${device.name} » ?`,
        message: 'L’écran s’éteindra quelques secondes puis se reconnectera tout seul.',
        confirmLabel: 'Redémarrer',
        danger: true,
      });
      if (!yes) return;
    }
    setPending(type);
    await sendCommand(type);
    setPending(null);
  };

  const captureLabel = capturedAt
    ? `Capture ${formatAgo(capturedAt, now)}`
    : shownAt && !missing
      ? `Affichée depuis ${formatTime(shownAt)}`
      : '';

  return (
    <section className="card flex-col" aria-labelledby="live-title">
      <div className="card-head baseline">
        <h2 className="card-title" id="live-title">
          Écran en direct
        </h2>
        <span className="card-sub" aria-live="polite">
          {polling ? 'En attente de l’écran…' : captureLabel}
        </span>
      </div>

      <div className="screen-frame">
        {!missing && (
          <img
            key={stamp}
            src={`${shotUrl}?t=${stamp}`}
            alt={`Dernière capture de « ${device.name} »`}
            onLoad={() => {
              setLoaded(true);
              setMissing(false);
              setShownAt(Date.now());
            }}
            onError={() => {
              setMissing(true);
              setLoaded(false);
            }}
            style={{ opacity: loaded ? 1 : 0 }}
          />
        )}
        {missing && (
          <div className="screen-empty">
            <Icon name="camera" size={26} />
            <strong>Aucune capture pour l’instant</strong>
            <span>Demande une capture pour voir ce qu’affiche cet écran.</span>
          </div>
        )}
        {!missing && !loaded && (
          <div className="screen-empty">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
        {polling && (
          <div className="screen-overlay" role="status">
            <span className="spinner" aria-hidden="true" />
            Capture en cours…
          </div>
        )}
      </div>

      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-outline btn-grow"
          onClick={() => void requestCapture()}
          disabled={!paired || polling || pending !== null}
        >
          {pending === 'screenshot' || polling ? <span className="spinner" aria-hidden="true" /> : <Icon name="camera" size={17} />}
          Actualiser la capture
        </button>
        <button type="button" className="btn btn-outline btn-grow" onClick={() => setMessageOpen(true)} disabled={!paired}>
          <Icon name="message" size={17} strokeWidth={2.2} />
          Message
        </button>
      </div>
      <div className="remote-grid">
        <BusyButton className="btn btn-grow" busy={pending === 'wake'} disabled={!paired || pending !== null} onClick={() => void run('wake')}>
          Réveiller
        </BusyButton>
        <BusyButton className="btn btn-grow" busy={pending === 'lock'} disabled={!paired || pending !== null} onClick={() => void run('lock')}>
          Verrouiller
        </BusyButton>
        <BusyButton className="btn btn-grow" busy={pending === 'reboot'} disabled={!paired || pending !== null} onClick={() => void run('reboot')}>
          Redémarrer
        </BusyButton>
      </div>
      {!paired && <p className="small muted">Cet écran n’est pas associé : ré-associe-le depuis la carte « Écran » pour le piloter.</p>}

      {messageOpen && (
        <MessageModal
          onClose={() => setMessageOpen(false)}
          onSend={async (text) => {
            const ok = await sendCommand('message', text);
            if (ok) setMessageOpen(false);
          }}
        />
      )}
    </section>
  );
}
