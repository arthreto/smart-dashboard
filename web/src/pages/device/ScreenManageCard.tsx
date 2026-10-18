import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api';
import { Modal, useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton, Field, SettingRow } from '../../components/ui';
import { formatAgo, formatDateTime, plural } from '../../format';
import { useNow } from '../../hooks';
import type { DeviceInfo } from '../../types';
import { PairingPanel } from './PairingPanel';

/** Fiche d'un écran : état, nom, ré-association et retrait. */
export function ScreenManageCard({
  device,
  onChanged,
}: {
  device: DeviceInfo;
  onChanged: (next?: Partial<DeviceInfo>) => void | Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const now = useNow(15_000);
  const [renaming, setRenaming] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const remove = async () => {
    const yes = await confirm({
      title: `Retirer « ${device.name} » ?`,
      message:
        'L’écran sera dissocié et ses réveils, sa disposition et ses réglages seront supprimés. Les tâches, habitudes et services du foyer ne changent pas.',
      confirmLabel: 'Retirer l’écran',
      danger: true,
    });
    if (!yes) return;
    setRemoving(true);
    try {
      await api.del(`/api/devices/${device.id}`);
      toast.success(`« ${device.name} » a été retiré.`);
      navigate('/ecrans', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setRemoving(false);
    }
  };

  return (
    <section className="card" aria-labelledby="manage-title">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2 className="card-title" id="manage-title">
          Écran
        </h2>
        {device.paired ? (
          <span className={device.online ? 'pill pill-ok pill-dot' : 'pill pill-dot'}>{device.online ? 'EN LIGNE' : 'HORS LIGNE'}</span>
        ) : (
          <span className="pill pill-warning pill-dot">NON ASSOCIÉ</span>
        )}
      </div>

      <div className="divided">
        <SettingRow label="Nom" sub="Affiché dans la console et sur l’écran">
          <span style={{ fontWeight: 700 }}>{device.name}</span>
          <button type="button" className="btn btn-sm" onClick={() => setRenaming(true)}>
            Renommer
          </button>
        </SettingRow>
        <SettingRow label="Dernier contact">
          <span style={{ fontWeight: 700 }}>{device.lastSeenAt ? formatAgo(device.lastSeenAt, now) : 'Jamais'}</span>
        </SettingRow>
        {typeof device.battery === 'number' && (
          <SettingRow label="Batterie">
            <span className="text-2">
              {device.battery} %{device.charging ? ' · en charge' : ''}
              {!device.charging && typeof device.autonomyDays === 'number'
                ? ` · environ ${plural(Math.round(device.autonomyDays), 'jour')} d’autonomie`
                : ''}
            </span>
          </SettingRow>
        )}
        <SettingRow label="Firmware">
          <span className="mono">{device.firmware || '—'}</span>
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
        {device.pairedAt && (
          <SettingRow label="Associé le">
            <span className="text-2">{formatDateTime(device.pairedAt)}</span>
          </SettingRow>
        )}
      </div>

      <div className="row-wrap" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-outline btn-grow" onClick={() => setRepairOpen(true)} disabled={removing}>
          Ré-associer
        </button>
        <BusyButton className="btn btn-danger btn-grow" busy={removing} onClick={() => void remove()}>
          Retirer cet écran
        </BusyButton>
      </div>

      {renaming && (
        <RenameModal
          device={device}
          onClose={() => setRenaming(false)}
          onSaved={(name) => {
            setRenaming(false);
            void onChanged({ name });
          }}
        />
      )}
      {repairOpen && (
        <Modal title={`Ré-associer « ${device.name} »`} onClose={() => setRepairOpen(false)}>
          <PairingPanel
            deviceId={device.id}
            autoStart
            onPaired={() => {
              setRepairOpen(false);
              toast.success(`« ${device.name} » est de nouveau associé.`);
              void onChanged();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function RenameModal({ device, onClose, onSaved }: { device: DeviceInfo; onClose: () => void; onSaved: (name: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError('Donne un nom à l’écran.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.patch<DeviceInfo>(`/api/devices/${device.id}`, { name: trimmed });
      toast.success('Écran renommé.');
      onSaved(saved.name);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Renommer l’écran" onClose={onClose} busy={busy}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Nom" htmlFor="screen-name" hint="Par exemple « Chambre », « Cuisine » ou « Bureau »." error={error}>
          <input id="screen-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={!trimmed || trimmed === device.name}>
            Enregistrer
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}
