import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api';
import { useToast } from '../../components/Toast';
import { BusyButton } from '../../components/ui';
import { GripIcon, Icon } from '../../icons';
import { WIDGET_COLORS, widgetLabel } from '../../services';
import type { AvailableWidget, DeviceInfo, LayoutItem } from '../../types';

const COLS = 4;
const ROWS = 2;
const MAX_CELLS = COLS * ROWS;

/** Placement séquentiel (comme la grille de la tablette) : une tuile large ne se coupe pas en fin de rangée. */
function rowsNeeded(items: LayoutItem[]): number {
  let row = 1;
  let col = 0;
  for (const it of items) {
    if (col + it.span > COLS) {
      row += 1;
      col = 0;
    }
    col += it.span;
  }
  return items.length ? row : 0;
}

const normalize = (items: LayoutItem[]): LayoutItem[] => items.map((i) => ({ id: i.id, span: i.span === 2 ? 2 : 1 }));

export function LayoutCard({ device, onSaved }: { device: DeviceInfo; onSaved: (layout: LayoutItem[]) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<LayoutItem[]>(() => normalize(device.layout));
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    setItems(normalize(device.layout));
    setSelected(null);
  }, [device.layout]);

  // Catalogue : widgets placés côté serveur + widgets disponibles.
  const catalog = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of device.layout) map.set(it.id, widgetLabel(it.id));
    for (const w of device.availableWidgets as AvailableWidget[]) map.set(w.id, widgetLabel(w.id, w.label));
    return map;
  }, [device.layout, device.availableWidgets]);

  const available = [...catalog.keys()].filter((id) => !items.some((i) => i.id === id));
  const cells = items.reduce((n, i) => n + i.span, 0);
  const rows = rowsNeeded(items);
  const tooMany = cells > MAX_CELLS;
  const overflow = !tooMany && rows > ROWS;
  const invalid = tooMany || overflow;
  const dirty = JSON.stringify(items) !== JSON.stringify(normalize(device.layout));

  const label = (id: string) => catalog.get(id) ?? widgetLabel(id);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setItems(next);
    setSelected(to);
    setAnnounce(`${label(it.id)} déplacé en position ${to + 1} sur ${next.length}.`);
  };

  const toggleSpan = (index: number) => {
    const it = items[index];
    const span: 1 | 2 = it.span === 2 ? 1 : 2;
    setItems(items.map((x, i) => (i === index ? { ...x, span } : x)));
    setAnnounce(`${label(it.id)} : ${span === 2 ? 'deux colonnes' : 'une colonne'}.`);
  };

  const remove = (index: number) => {
    const it = items[index];
    setItems(items.filter((_, i) => i !== index));
    setSelected(null);
    setAnnounce(`${label(it.id)} retiré de l’accueil.`);
  };

  const add = (id: string) => {
    setItems([...items, { id, span: 1 }]);
    setSelected(items.length);
    setAnnounce(`${label(id)} ajouté en dernière position.`);
  };

  const send = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      await api.put('/api/device/layout', { widgets: items });
      onSaved(items);
      toast.success('Disposition envoyée à l’écran.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sel = selected !== null ? items[selected] : undefined;

  return (
    <section className="card flex-col" aria-labelledby="layout-title">
      <div className="card-head baseline">
        <h2 className="card-title" id="layout-title">
          Disposition de l’accueil
        </h2>
        <span className="card-sub">Sélectionne ou glisse une tuile</span>
      </div>

      <div className="layout-preview" role="list" aria-label={`Accueil de la tablette : ${COLS} colonnes, ${ROWS} rangées`}>
        {items.length === 0 && <div className="layout-empty">Accueil vide : ajoute des widgets ci-dessous.</div>}
        {items.map((it, i) => (
          <div
            key={it.id}
            role="listitem"
            className={[
              'layout-tile',
              it.span === 2 ? 'span-2' : '',
              selected === i ? 'selected' : '',
              dragIndex === i ? 'dragging' : '',
            ].join(' ')}
            style={{ background: WIDGET_COLORS[it.id] ?? '#222227' }}
            draggable
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => {
              if (dragIndex !== null) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
            }}
          >
            <button
              type="button"
              className="layout-tile-btn"
              aria-pressed={selected === i}
              aria-label={`${label(it.id)}, ${it.span === 2 ? 'deux colonnes' : 'une colonne'}, position ${i + 1}`}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              <GripIcon />
              <span>{label(it.id)}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      {sel && selected !== null ? (
        <div className="layout-toolbar" role="group" aria-label={`Actions pour ${label(sel.id)}`}>
          <span className="layout-toolbar-name">{label(sel.id)}</span>
          <button type="button" className="icon-btn" aria-label="Déplacer vers la gauche" onClick={() => move(selected, selected - 1)} disabled={selected === 0}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Déplacer vers la droite"
            onClick={() => move(selected, selected + 1)}
            disabled={selected === items.length - 1}
          >
            <Icon name="chevronRight" size={18} />
          </button>
          <button type="button" className="btn btn-sm" onClick={() => toggleSpan(selected)} aria-label={`Largeur : ${sel.span === 2 ? 'deux colonnes' : 'une colonne'}. Changer`}>
            {sel.span === 2 ? 'Largeur : 2 colonnes' : 'Largeur : 1 colonne'}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(selected)}>
            Retirer
          </button>
        </div>
      ) : null}

      <div className="small" aria-live="polite">
        {tooMany ? (
          <span className="text-error" style={{ fontWeight: 600 }}>
            {cells} cases utilisées sur {MAX_CELLS} : retire un widget ou réduis une tuile large.
          </span>
        ) : overflow ? (
          <span className="text-error" style={{ fontWeight: 600 }}>
            Une tuile large ne tient pas en fin de rangée : réorganise les tuiles pour tenir sur {ROWS} rangées.
          </span>
        ) : (
          <span className="muted">
            {cells} case{cells > 1 ? 's' : ''} utilisée{cells > 1 ? 's' : ''} sur {MAX_CELLS}
          </span>
        )}
      </div>

      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>
          Widgets disponibles
        </div>
        {available.length === 0 ? (
          <p className="small muted">Tous les widgets sont déjà sur l’accueil.</p>
        ) : (
          <div className="chips">
            {available.map((id) => (
              <button
                key={id}
                type="button"
                className="chip chip-add"
                onClick={() => add(id)}
                disabled={cells >= MAX_CELLS}
                aria-label={`Ajouter ${label(id)}`}
              >
                + {label(id)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => {
            setItems(normalize(device.layout));
            setSelected(null);
          }}
          disabled={!dirty || busy}
        >
          Réinitialiser
        </button>
        <BusyButton className="btn btn-sm btn-primary" busy={busy} disabled={!dirty || invalid} onClick={() => void send()}>
          Envoyer à l’écran
        </BusyButton>
      </div>
    </section>
  );
}
