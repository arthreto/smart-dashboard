import { useState } from 'react';
import { Modal } from './Modal';
import { BusyButton } from './ui';

const MESSAGE_MAX = 140;

/** Modale « message à l'écran » : un écran précis ou tous les écrans du foyer. */
export function MessageModal({
  title = 'Envoyer un message à l’écran',
  hint = 'S’affiche en grand sur la tablette',
  onClose,
  onSend,
}: {
  title?: string;
  hint?: string;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = text.trim();
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!trimmed) return;
          setBusy(true);
          await onSend(trimmed);
          setBusy(false);
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="screen-message">
            Message
          </label>
          <textarea
            id="screen-message"
            className="input textarea"
            rows={3}
            maxLength={MESSAGE_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="À table !"
            aria-describedby="screen-message-count"
            autoFocus
          />
          <span className="field-hint" id="screen-message-count">
            {hint} · {text.length}/{MESSAGE_MAX}
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <BusyButton type="submit" className="btn btn-primary" busy={busy} disabled={!trimmed} icon="message">
            Envoyer
          </BusyButton>
        </div>
      </form>
    </Modal>
  );
}
