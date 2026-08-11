// Läden verwalten. Die Reihenfolge hier ist die Reihenfolge, in der die
// Liste sortiert wird - also am besten so, wie du sie wirklich abläufst.

import { add, el, colorFor } from '../util.js';
import * as store from '../state.js';
import { toast, sheet, confirmSheet, emptyState, field } from './shell.js';

const PALETTE = ['#e4572e', '#2e86ab', '#38a169', '#8e44ad', '#d99a00', '#0d9488', '#c2185b', '#5c6bc0', '#6b7280'];

export const title = () => 'Läden';

export function subtitle() {
  const count = store.activeStores().length;
  return count ? `${count} Läden · Reihenfolge = Einkaufsroute` : 'Noch keine Läden';
}

export function render() {
  const stores = store.activeStores();
  const items = store.activeItems();
  const wrap = el('div');

  add(wrap, 
    el('p.small.muted', { style: { margin: '2px 4px 12px' } },
      'Die Reihenfolge bestimmt, wie die Einkaufsliste sortiert ist. Mit den Pfeilen verschiebst du einen Laden nach oben oder unten.'),
  );

  if (!stores.length) {
    add(wrap, emptyState('🏬', 'Keine Läden angelegt', 'Ohne Läden landen alle Artikel in einer Sammelgruppe.'));
  } else {
    const card = el('div.card');
    stores.forEach((laden, index) => {
      const openCount = items.filter((i) => i.storeId === laden.id && !i.done).length;
      add(card, 
        el('div.row',
          el('div.dot', { style: { background: laden.color || colorFor(laden.name), width: '14px', height: '14px' } }),
          el('div.grow', {
            onclick: () => editStore(laden.id),
          },
            el('div.bold', laden.name),
            el('div.small.muted', [
              openCount ? `${openCount} offen` : 'nichts offen',
              laden.note,
            ].filter(Boolean).join(' · ')),
          ),
          el('button.edit-btn', {
            'aria-label': 'Nach oben',
            disabled: index === 0,
            style: { opacity: index === 0 ? '.25' : '1' },
            onclick: () => store.moveStore(laden.id, -1),
          }, '↑'),
          el('button.edit-btn', {
            'aria-label': 'Nach unten',
            disabled: index === stores.length - 1,
            style: { opacity: index === stores.length - 1 ? '.25' : '1' },
            onclick: () => store.moveStore(laden.id, 1),
          }, '↓'),
          el('button.edit-btn', { 'aria-label': 'Bearbeiten', onclick: () => editStore(laden.id) }, '⋯'),
        ),
      );
    });
    add(wrap, card);
  }

  add(wrap, 
    el('button.btn.block', { onclick: () => editStore(null) }, '+ Laden hinzufügen'),
  );

  return wrap;
}

function editStore(id) {
  const existing = id ? store.storeById(id) : null;
  const isNew = !existing;

  sheet(isNew ? 'Neuer Laden' : 'Laden bearbeiten', (body, close) => {
    const name = el('input', {
      type: 'text',
      value: existing?.name ?? '',
      placeholder: 'z. B. Denner, Türkischer Laden, Apotheke',
    });
    const note = el('input', {
      type: 'text',
      value: existing?.note ?? '',
      placeholder: 'z. B. nur samstags, hat den guten Käse',
    });

    let color = existing?.color || PALETTE[0];
    const swatches = el('div.chips');
    const paint = () => {
      swatches.replaceChildren(
        ...PALETTE.map((value) =>
          el('button.chip', {
            type: 'button',
            style: value === color ? { borderColor: value, borderWidth: '2px' } : {},
            onclick: () => {
              color = value;
              paint();
            },
          }, el('span.dot', { style: { background: value, width: '15px', height: '15px' } }), value === color ? 'gewählt' : ''),
        ),
      );
    };
    paint();

    add(body, 
      field('Name', name),
      field('Notiz', note),
      el('div.field', el('label', 'Farbe'), swatches),
    );

    if (!isNew) {
      add(body, 
        el('div.btn-row',
          el('button.btn.danger', {
            onclick: async () => {
              close();
              const ok = await confirmSheet(
                `${existing.name} löschen?`,
                'Artikel dieses Ladens bleiben auf der Liste, landen aber unter "Noch kein Laden".',
                { confirmLabel: 'Laden löschen' },
              );
              if (ok) {
                store.removeStore(existing.id);
                toast(`${existing.name} gelöscht`);
              }
            },
          }, 'Löschen'),
          el('button.btn.primary', {
            onclick: () => {
              const trimmed = name.value.trim();
              if (!trimmed) return;
              store.updateStore(existing.id, { name: trimmed, note: note.value.trim() || null, color });
              close();
              toast('Gespeichert');
            },
          }, 'Speichern'),
        ),
      );
    } else {
      add(body, 
        el('div.btn-row',
          el('button.btn', { onclick: close }, 'Abbrechen'),
          el('button.btn.primary', {
            onclick: () => {
              const trimmed = name.value.trim();
              if (!trimmed) return;
              const created = store.addStore(trimmed, { color, note: note.value.trim() || null });
              close();
              if (created) toast(`${created.name} angelegt`);
            },
          }, 'Anlegen'),
        ),
      );
    }
  });
}
