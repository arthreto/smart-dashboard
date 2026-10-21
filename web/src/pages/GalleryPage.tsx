import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Modal, useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { BusyButton, ErrorState, Field, Skeleton, Spinner } from '../components/ui';
import { formatNumber } from '../format';
import { useApiData, useBusy, useDocumentTitle, useNow } from '../hooks';
import { Icon } from '../icons';
import { MIN_CODE_LENGTH, createKeys, rewrap, unlock, type GalleryKeys } from '../gallery/crypto';
import { fileName, isUnlocked, loadPoster, loadVideo, lock, onLockChange, setUnlocked, touch, type GalleryVideo } from '../gallery/store';

interface GalleryState {
  configured: boolean;
  keys: GalleryKeys | null;
  devices: { id: number; name: string; busy: boolean; mine: boolean }[];
  videos: GalleryVideo[];
  usedBytes: number;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} Ko`;
  if (bytes < 1024 ** 3) return `${formatNumber(Math.round(bytes / 1024 / 1024))} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
}

function durationLabel(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${time}`;
}

function elapsed(v: GalleryVideo, now: number): string {
  if (!v.startedAt) return '0:00';
  return durationLabel(Math.max(0, now - Date.parse(v.startedAt)));
}

/** Champ de code secret avec bouton afficher / masquer. */
function CodeInput({ id, value, onChange, autoFocus, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="code-field">
      <input
        id={id}
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="icon-btn" aria-label={show ? 'Masquer le code' : 'Afficher le code'} onClick={() => setShow((s) => !s)}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ première fois

function SetupCard({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length < MIN_CODE_LENGTH) return setError(`Au moins ${MIN_CODE_LENGTH} caractères.`);
    if (code !== again) return setError('Les deux codes ne sont pas identiques.');
    setError(null);
    void run(async () => {
      try {
        const keys = await createKeys(code);
        await api.post('/api/gallery/setup', keys);
        const priv = await unlock(keys, code);
        if (priv) setUnlocked(priv);
        toast.success('Galerie protégée. Tu peux lancer un enregistrement.');
        onDone();
      } catch (err) {
        setError(errorMessage(err));
      }
    });
  };

  return (
    <section className="card gallery-setup" aria-labelledby="setup-title">
      <div className="gallery-lock-icon" aria-hidden="true">
        <Icon name="lock" size={26} />
      </div>
      <h2 id="setup-title" className="card-title">
        Protège ta galerie par un code secret
      </h2>
      <ul className="gallery-points">
        <li>
          <Icon name="shield" size={18} /> La tablette chiffre chaque vidéo <strong>avant</strong> de l’envoyer : le serveur ne stocke que des
          données illisibles.
        </li>
        <li>
          <Icon name="key" size={18} /> Ton code ne quitte jamais ce navigateur. Ni le serveur, ni la personne qui gère le VPS ne peuvent voir tes
          vidéos.
        </li>
        <li>
          <Icon name="user" size={18} /> Les autres membres du foyer ne voient pas ta galerie.
        </li>
      </ul>
      <div className="banner warning">
        <Icon name="alert" size={20} />
        <div>
          <strong>Si tu oublies ce code, tes vidéos sont perdues</strong> : personne ne pourra les récupérer. Note-le dans ton gestionnaire de mots de
          passe. Choisis-le long (une phrase par exemple) : quelqu’un qui récupérerait les fichiers du serveur pourrait essayer de le deviner.
        </div>
      </div>
      <form className="stack" onSubmit={submit} style={{ gap: 14, maxWidth: 420 }}>
        <Field label="Code secret" htmlFor="code-new" hint={`${MIN_CODE_LENGTH} caractères minimum`}>
          <CodeInput id="code-new" value={code} onChange={setCode} autoFocus autoComplete="new-password" />
        </Field>
        <Field label="Confirme le code" htmlFor="code-again" error={error}>
          <CodeInput id="code-again" value={again} onChange={setAgain} autoComplete="new-password" />
        </Field>
        <BusyButton type="submit" className="btn btn-primary" busy={busy} busyLabel="Création des clés…" icon="lock">
          Protéger ma galerie
        </BusyButton>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ verrouillée

function UnlockCard({ keys, onForgot }: { keys: GalleryKeys; onForgot: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code) return;
    void run(async () => {
      const priv = await unlock(keys, code).catch((err) => {
        setError(errorMessage(err));
        return null;
      });
      if (priv) {
        setError(null);
        setUnlocked(priv);
      } else {
        setError((e) => e ?? 'Code incorrect.');
      }
    });
  };

  return (
    <section className="card gallery-setup" aria-labelledby="unlock-title">
      <div className="gallery-lock-icon" aria-hidden="true">
        <Icon name="lock" size={26} />
      </div>
      <h2 id="unlock-title" className="card-title">
        Galerie verrouillée
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Saisis ton code secret pour voir tes vidéos. Il sert à les déchiffrer ici, dans ton navigateur.
      </p>
      <form className="row-wrap" onSubmit={submit} style={{ gap: 10, alignItems: 'flex-start' }}>
        <Field label="Code secret" htmlFor="code-unlock" error={error} className="gallery-unlock-field">
          <CodeInput id="code-unlock" value={code} onChange={setCode} autoFocus autoComplete="current-password" />
        </Field>
        <BusyButton type="submit" className="btn btn-primary gallery-unlock-btn" busy={busy} busyLabel="Vérification…" icon="lock">
          Déverrouiller
        </BusyButton>
      </form>
      <button type="button" className="link-btn" onClick={onForgot}>
        Code oublié ?
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ enregistrement

function RecordCard({ data, now, onChange }: { data: GalleryState; now: number; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  const active = data.videos.filter((v) => v.status === 'waiting' || v.status === 'recording');

  const record = async (deviceId: number) => {
    setBusyId(deviceId);
    try {
      await api.post('/api/gallery/record', { deviceId });
      await onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const stop = async (v: GalleryVideo) => {
    setBusyId(v.deviceId);
    try {
      await api.post(`/api/gallery/videos/${v.id}/stop`);
      await onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card" aria-labelledby="rec-title">
      <div className="card-head">
        <div>
          <h2 id="rec-title" className="card-title">
            Enregistrer
          </h2>
          <div className="card-sub">Caméra et micro de la tablette. Elle affiche « ● REC » tant que l’enregistrement dure (1 h au plus).</div>
        </div>
      </div>
      {data.devices.length === 0 ? (
        <div className="empty">
          <strong>Aucun écran associé</strong>
          Associe ta tablette depuis « Mes écrans » pour enregistrer.
        </div>
      ) : (
        <ul className="gallery-devices">
          {data.devices.map((d) => {
            const mine = active.find((v) => v.deviceId === d.id);
            return (
              <li key={d.id} className={`gallery-device${mine ? ' live' : ''}`}>
                <span className="tile" aria-hidden="true" style={{ background: mine ? 'var(--red)' : 'var(--fill)' }}>
                  <Icon name="camera" size={18} />
                </span>
                <div className="spacer" style={{ minWidth: 0 }}>
                  <div className="screen-row-name">{d.name}</div>
                  <div className="screen-row-sub" aria-live="polite">
                    {mine ? (
                      mine.status === 'waiting' ? (
                        <>
                          <Spinner /> Démarrage sur la tablette…
                        </>
                      ) : mine.stopRequested ? (
                        <>
                          <Spinner /> Arrêt, envoi de la fin…
                        </>
                      ) : (
                        <>
                          <span className="rec-dot" aria-hidden="true" /> En cours · <span className="tabular">{elapsed(mine, now)}</span>
                        </>
                      )
                    ) : d.busy ? (
                      'Utilisée par un autre membre du foyer'
                    ) : (
                      'Prête'
                    )}
                  </div>
                </div>
                {mine ? (
                  <BusyButton className="btn btn-danger" busy={busyId === d.id} onClick={() => void stop(mine)} disabled={mine.stopRequested}>
                    <span className="stop-square" aria-hidden="true" /> Arrêter
                  </BusyButton>
                ) : (
                  <BusyButton className="btn btn-primary" busy={busyId === d.id} disabled={d.busy} onClick={() => void record(d.id)}>
                    <span className="rec-dot light" aria-hidden="true" /> Enregistrer
                  </BusyButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ vidéos

function Poster({ video }: { video: GalleryVideo }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ready = video.chunks > 0 && (video.status === 'done' || video.status === 'error' || video.chunks > 1);

  useEffect(() => {
    if (!ready || url || failed) return;
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      loadPoster(video.id)
        .then((u) => !cancelled && setUrl(u))
        .catch(() => !cancelled && setFailed(true));
    });
    io.observe(node);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [ready, url, failed, video.id]);

  return (
    <div className="gallery-poster" ref={ref}>
      {url ? <img src={url} alt="" /> : <Icon name="film" size={30} />}
    </div>
  );
}

function statusChip(v: GalleryVideo) {
  if (v.status === 'recording') return <span className="chip chip-warning">● En cours</span>;
  if (v.status === 'waiting') return <span className="chip chip-info">Démarrage…</span>;
  if (v.status === 'cancelled') return <span className="chip">Annulée</span>;
  if (v.status === 'error') return <span className="chip chip-warning">Interrompue</span>;
  return null;
}

function VideoCard({ video, onPlay, onDelete, onDownload, downloading }: { video: GalleryVideo; onPlay: () => void; onDelete: () => void; onDownload: () => void; downloading: number | null }) {
  const playable = video.chunks > 0 && video.status !== 'waiting';
  return (
    <li className="gallery-item">
      <button type="button" className="gallery-thumb" onClick={onPlay} disabled={!playable} aria-label={`Regarder la vidéo du ${dateLabel(video.startedAt ?? video.createdAt)}`}>
        <Poster video={video} />
        {playable && (
          <span className="gallery-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
            </svg>
          </span>
        )}
        {video.durationMs !== null && video.status === 'done' && <span className="gallery-duration tabular">{durationLabel(video.durationMs)}</span>}
      </button>
      <div className="gallery-meta">
        <div className="gallery-title">{dateLabel(video.startedAt ?? video.createdAt)}</div>
        <div className="gallery-sub">
          {video.deviceName}
          {video.bytes > 0 && ` · ${sizeLabel(video.bytes)}`}
          {statusChip(video)}
        </div>
        {video.error && <div className="gallery-error">{video.error}</div>}
      </div>
      <div className="gallery-actions">
        <button type="button" className="icon-btn" onClick={onDownload} disabled={!playable || downloading !== null} aria-label="Télécharger en MP4" title="Télécharger (MP4)">
          {downloading !== null ? <span className="tabular small">{Math.round(downloading * 100)} %</span> : <Icon name="download" size={18} />}
        </button>
        <button type="button" className="icon-btn" onClick={onDelete} disabled={video.status === 'recording' || video.status === 'waiting'} aria-label="Supprimer la vidéo" title="Supprimer">
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}

function saveFile(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Player({ video, onClose }: { video: GalleryVideo; onClose: () => void }) {
  const [progress, setProgress] = useState(0);
  const [mp4, setMp4] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    loadVideo(video.id, setProgress, controller.signal)
      .then(({ mp4 }) => {
        if (controller.signal.aborted) return;
        setMp4(mp4);
        objectUrl = URL.createObjectURL(new Blob([mp4], { type: 'video/mp4' }));
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video.id]);

  return (
    <Modal title={`${video.deviceName} · ${dateLabel(video.startedAt ?? video.createdAt)}`} onClose={onClose} width={920}>
      <div className="gallery-player">
        {url ? (
          <video src={url} controls autoPlay playsInline onPlay={touch} />
        ) : error ? (
          <div className="banner error" role="alert">
            <Icon name="alert" size={20} />
            <div>{error}</div>
          </div>
        ) : (
          <div className="gallery-progress" aria-live="polite">
            <Spinner large />
            <div>Déchiffrement… {Math.round(progress * 100)} %</div>
            <div className="progress blue" style={{ width: 260 }}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      {video.status === 'recording' && <p className="muted small">Enregistrement en cours : la vidéo s’arrête au dernier morceau reçu.</p>}
      {video.error && <p className="muted small">{video.error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Fermer
        </button>
        <button type="button" className="btn btn-primary" disabled={!mp4} onClick={() => mp4 && saveFile(mp4, fileName(video))}>
          <Icon name="download" size={17} /> Télécharger (MP4)
        </button>
      </div>
    </Modal>
  );
}

function ChangeCodeModal({ keys, onClose, onDone }: { keys: GalleryKeys; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length < MIN_CODE_LENGTH) return setError(`Le nouveau code doit faire au moins ${MIN_CODE_LENGTH} caractères.`);
    if (code !== again) return setError('Les deux nouveaux codes ne sont pas identiques.');
    void run(async () => {
      try {
        const next = await rewrap(keys, current, code);
        if (!next) return setError('Code actuel incorrect.');
        await api.put('/api/gallery/code', next);
        toast.success('Code de la galerie modifié.');
        onDone();
      } catch (err) {
        setError(errorMessage(err));
      }
    });
  };

  return (
    <Modal title="Changer le code de la galerie" onClose={onClose} busy={busy}>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <p className="modal-text" style={{ margin: 0 }}>
          Tes vidéos restent lisibles : seule la protection de ta clé change.
        </p>
        <Field label="Code actuel" htmlFor="code-cur">
          <CodeInput id="code-cur" value={current} onChange={setCurrent} autoFocus autoComplete="current-password" />
        </Field>
        <Field label="Nouveau code" htmlFor="code-n1" hint={`${MIN_CODE_LENGTH} caractères minimum`}>
          <CodeInput id="code-n1" value={code} onChange={setCode} autoComplete="new-password" />
        </Field>
        <Field label="Confirme le nouveau code" htmlFor="code-n2" error={error}>
          <CodeInput id="code-n2" value={again} onChange={setAgain} autoComplete="new-password" />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} busyLabel="Chiffrement…">
            Changer le code
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}

function ResetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, run] = useBusy();
  return (
    <Modal title="Code oublié" onClose={onClose} busy={busy}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="banner error">
          <Icon name="alert" size={20} />
          <div>
            Sans le code, tes vidéos ne peuvent plus être déchiffrées. La seule solution est de <strong>tout effacer</strong> (vidéos et clés) pour
            repartir avec un nouveau code.
          </div>
        </div>
        <Field label="Tape EFFACER pour confirmer" htmlFor="reset-confirm">
          <input id="reset-confirm" className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton
            className="btn btn-danger"
            busy={busy}
            disabled={text.trim().toUpperCase() !== 'EFFACER'}
            onClick={() =>
              void run(async () => {
                try {
                  await api.post('/api/gallery/reset', { confirm: 'EFFACER' });
                  lock();
                  toast.success('Galerie effacée. Choisis un nouveau code.');
                  onDone();
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              })
            }
          >
            Tout effacer
          </BusyButton>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ page

export function GalleryPage() {
  useDocumentTitle('Galerie');
  const toast = useToast();
  const confirm = useConfirm();
  const gallery = useApiData<GalleryState>('/api/gallery');
  const [unlocked, setUnlockedState] = useState(isUnlocked());
  const [playing, setPlaying] = useState<GalleryVideo | null>(null);
  const [changing, setChanging] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, number>>({});
  const data = gallery.data;
  const live = !!data?.videos.some((v) => v.status === 'waiting' || v.status === 'recording');
  const now = useNow(live ? 1000 : 30_000);

  useEffect(() => onLockChange(() => setUnlockedState(isUnlocked())), []);
  // Verrouillage automatique après inactivité (vérifié chaque minute).
  useEffect(() => {
    const id = window.setInterval(() => setUnlockedState(isUnlocked()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Suivi en direct pendant un enregistrement.
  const { reload } = gallery;
  useEffect(() => {
    if (!data?.configured) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, live ? 2000 : 20_000);
    return () => window.clearInterval(id);
  }, [data?.configured, live, reload]);

  const remove = async (v: GalleryVideo) => {
    const ok = await confirm({
      title: 'Supprimer cette vidéo ?',
      message: `${dateLabel(v.startedAt ?? v.createdAt)} · ${v.deviceName}. Elle sera effacée du serveur, définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/gallery/videos/${v.id}`);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const download = async (v: GalleryVideo) => {
    setDownloads((d) => ({ ...d, [v.id]: 0 }));
    try {
      const { mp4 } = await loadVideo(v.id, (p) => setDownloads((d) => ({ ...d, [v.id]: p })));
      saveFile(mp4, fileName(v));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloads(({ [v.id]: _done, ...rest }) => rest);
    }
  };

  const videos = data?.videos ?? [];
  const showContent = data?.configured && unlocked && data.keys;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-kicker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="lock" size={13} strokeWidth={2.4} /> Chiffrée de bout en bout
          </div>
          <h1 className="page-title">Galerie</h1>
        </div>
        {showContent && (
          <div className="page-actions">
            <button type="button" className="btn btn-outline" onClick={() => setChanging(true)}>
              <Icon name="key" size={17} /> Changer le code
            </button>
            <button type="button" className="btn btn-outline" onClick={() => lock()}>
              <Icon name="lock" size={17} /> Verrouiller
            </button>
          </div>
        )}
      </header>

      {gallery.error && !data && <ErrorState message={gallery.error} onRetry={() => void reload()} />}
      {!data && !gallery.error && <Skeleton height={220} radius={20} />}

      {data && !data.configured && <SetupCard onDone={() => void reload()} />}
      {data?.configured && data.keys && !unlocked && <UnlockCard keys={data.keys} onForgot={() => setResetting(true)} />}

      {showContent && (
        <>
          <RecordCard data={data} now={now} onChange={reload} />
          <section className="card" aria-labelledby="videos-title">
            <div className="card-head">
              <div>
                <h2 id="videos-title" className="card-title">
                  Vidéos
                </h2>
                <div className="card-sub">
                  {videos.length === 0 ? 'Aucune vidéo pour l’instant' : `${videos.length} vidéo${videos.length > 1 ? 's' : ''} · ${sizeLabel(data.usedBytes)} utilisés`}
                </div>
              </div>
            </div>
            {videos.length === 0 ? (
              <div className="empty">
                <strong>Ta galerie est vide</strong>
                Lance un enregistrement : la vidéo apparaîtra ici, prête à être regardée ou téléchargée.
              </div>
            ) : (
              <ul className="gallery-grid">
                {videos.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    onPlay={() => setPlaying(v)}
                    onDelete={() => void remove(v)}
                    onDownload={() => void download(v)}
                    downloading={downloads[v.id] ?? null}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {playing && <Player video={playing} onClose={() => setPlaying(null)} />}
      {changing && data?.keys && (
        <ChangeCodeModal
          keys={data.keys}
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            void reload();
          }}
        />
      )}
      {resetting && (
        <ResetModal
          onClose={() => setResetting(false)}
          onDone={() => {
            setResetting(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
