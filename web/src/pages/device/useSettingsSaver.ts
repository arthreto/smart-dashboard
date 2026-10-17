import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api';
import { useToast } from '../../components/Toast';
import type { DeviceInfo, DeviceSettings } from '../../types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SettingsSaver {
  status: SaveStatus;
  /** Applique tout de suite à l'interface, enregistre après un court délai (regroupe les changements rapides). */
  update: (patch: Partial<DeviceSettings>, opts?: { immediate?: boolean }) => void;
}

const DEBOUNCE_MS = 700;

/** Enregistrement automatique des réglages de l'écran (PUT /api/device/settings, corps partiel). */
export function useSettingsSaver(
  setDevice: React.Dispatch<React.SetStateAction<DeviceInfo | null>>,
  reload: () => Promise<void>,
): SettingsSaver {
  const toast = useToast();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pending = useRef<Partial<DeviceSettings>>({});
  const timer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    setStatus('saving');
    try {
      const saved = await api.put<DeviceSettings>('/api/device/settings', patch);
      setDevice((d) => (d ? { ...d, settings: { ...d.settings, ...saved, ...pending.current } } : d));
      setStatus('saved');
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    } catch (err) {
      setStatus('error');
      toast.error(`Réglage non enregistré : ${errorMessage(err)}`);
      void reload();
    }
  }, [reload, setDevice, toast]);

  const update = useCallback<SettingsSaver['update']>(
    (patch, opts) => {
      setDevice((d) => (d ? { ...d, settings: { ...d.settings, ...patch } } : d));
      pending.current = { ...pending.current, ...patch };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), opts?.immediate ? 0 : DEBOUNCE_MS);
    },
    [flush, setDevice],
  );

  // Ne rien perdre si on quitte la page pendant le délai.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      window.clearTimeout(savedTimer.current);
      if (Object.keys(pending.current).length) void flushRef.current();
    },
    [],
  );

  return { status, update };
}

export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case 'saving':
      return 'Enregistrement…';
    case 'saved':
      return 'Enregistré';
    case 'error':
      return 'Échec de l’enregistrement';
    default:
      return 'Enregistrement automatique';
  }
}
