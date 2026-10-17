import { useRef, useState } from 'react';
import { api, downloadFile, errorMessage } from '../../api';
import { useConfirm } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { BusyButton } from '../../components/ui';

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export function BackupCard({ onRestored }: { onRestored: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const exportData = async () => {
    setBusy('export');
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadFile('/api/backup', `smart-dashboard-sauvegarde-${date}.json`);
      toast.success('Sauvegarde téléchargée.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    if (file.size > MAX_BACKUP_BYTES) {
      toast.error('Ce fichier est trop volumineux pour être une sauvegarde.');
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast.error('Ce fichier n’est pas un JSON valide.');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      toast.error('Ce fichier ne ressemble pas à une sauvegarde Smart Dashboard.');
      return;
    }
    const yes = await confirm({
      title: 'Restaurer cette sauvegarde ?',
      message: (
        <>
          Les habitudes, réveils, réglages et la disposition actuels seront <strong>remplacés</strong> par ceux de « {file.name} ».
          Les clés API et mots de passe ne sont pas concernés.
        </>
      ),
      confirmLabel: 'Restaurer',
      danger: true,
    });
    if (!yes) return;
    setBusy('import');
    try {
      await api.post('/api/backup', data);
      toast.success('Sauvegarde restaurée.');
      onRestored();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-labelledby="backup-title">
      <h2 className="card-title" id="backup-title" style={{ marginBottom: 6 }}>
        Sauvegarde
      </h2>
      <p className="text-2" style={{ fontSize: 14, lineHeight: 1.45 }}>
        Exporte toutes tes données (habitudes, historique, réveils, réglages) dans un fichier JSON. Les clés API et mots de passe ne
        sont jamais inclus.
      </p>
      <div className="row-wrap" style={{ marginTop: 14 }}>
        <BusyButton className="btn btn-grow" busy={busy === 'export'} disabled={busy !== null} onClick={() => void exportData()} icon="download">
          Exporter mes données
        </BusyButton>
        <BusyButton className="btn btn-grow" busy={busy === 'import'} disabled={busy !== null} onClick={() => fileRef.current?.click()} icon="upload">
          Restaurer
        </BusyButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void restore(file);
          }}
        />
      </div>
    </section>
  );
}
