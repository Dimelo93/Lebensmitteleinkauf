// Vorlagen für den Wocheneinkauf: Artikel, die immer wieder gebraucht
// werden, auf Knopfdruck in die Liste kippen.

import { add, el, formatAmount, colorFor } from '../util.js';
import { UNITS } from '../katalog.js';
import { parseLine } from '../parse.js';
import * as store from '../state.js';
import { toast, sheet, emptyState, field } from './shell.js';

// Auswahl überlebt das Neuzeichnen der Ansicht.
let selected = new Set();

export const title = () => 'Vorlagen';

export function subtitle() {
  const count = store.activeStaples().length;
  return count ? `${count} Standard-Artikel` : 'Noch keine Vorlagen';
}

export function render() {
  const staples = store.activeStaples();
  const wrap = el('div');

  // Verwaiste Auswahl aufräumen, falls inzwischen etwas gelöscht wurde.
  const ids = new Set(staples.map((s) => s.id));
  selected = new Set([...selected].filter((id) => ids.has(id)));

  add(wrap, 
    el('p.small.muted', { style: { margin: '2px 4px 12px' } },
      'Häkchen setzen und unten übernehmen. Was schon offen auf der Liste steht, wird nicht doppelt angelegt.'),
  );

  if (!staples.length) {
    add(wrap, emptyState('⭐', 'Keine Vorlagen', 'Trag ein, was du fast jede Woche brauchst: Milch, Brot, Reis, Poulet.'));
  } else {
    const byStore = new Map();
    for (const staple of staples) {
      const key = staple.storeId ?? 'null';
      if (!byStore.has(key)) byStore.set(key, []);
      byStore.get(key).push(staple);
    }

    const order = [...store.activeStores().map((s) => s.id), 'null'];
    for (const key of order) {
      const group = byStore.get(key === null ? 'null' : key);
      if (!group?.length) continue;
      const laden = store.storeById(key);

      const card = el('div.card');
      add(card, 
        el('div.store-head',
          el('div.dot', { style: { background: laden ? laden.color || colorFor(laden.name) : '#8a8f98' } }),
          el('div.grow', el('div.name', laden?.name ?? 'Ohne Laden')),
        ),
      );

      for (const staple of group) {
        const isOn = selected.has(staple.id);
        const amount = formatAmount(staple.qty, staple.unit);
        add(card, 
          el('div', { class: `item${isOn ? '' : ''}` },
            el('button.check', {
              style: isOn ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : {},
              onclick: () => {
                if (isOn) selected.delete(staple.id);
                else selected.add(staple.id);
                rerender();
              },
            }, '✓'),
            el('div.label', {
              onclick: () => {
                if (isOn) selected.delete(staple.id);
                else selected.add(staple.id);
                rerender();
              },
            },
              el('span.name', staple.name),
              amount ? el('div.meta', amount) : null,
            ),
            el('button.edit-btn', { onclick: () => editStaple(staple.id) }, '⋯'),
          ),
        );
      }
      add(wrap, card);
    }

    add(wrap, 
      el('div.btn-row',
        el('button.btn', {
          onclick: () => {
            selected = selected.size === staples.length ? new Set() : new Set(staples.map((s) => s.id));
            rerender();
          },
        }, selected.size === staples.length ? 'Keine' : 'Alle'),
        el('button.btn.primary', {
          disabled: !selected.size,
          onclick: () => {
            const added = store.addStaplesToList([...selected]);
            selected = new Set();
            toast(added ? `${added} Artikel auf die Liste` : 'Alles steht schon auf der Liste');
          },
        }, `Übernehmen${selected.size ? ` (${selected.size})` : ''}`),
      ),
    );
  }

  add(wrap, el('button.btn.block', { onclick: () => editStaple(null) }, '+ Vorlage hinzufügen'));

  // Aus dem Gedächtnis vorschlagen, was oft gekauft, aber nicht als
  // Vorlage hinterlegt ist.
  const known = new Set(staples.map((s) => s.name.toLowerCase()));
  const candidates = store.frequentSuggestions(20).filter((entry) => !known.has(entry.label.toLowerCase())).slice(0, 8);
  if (candidates.length) {
    add(wrap, 
      el('div.section-title', 'Als Vorlage vorschlagen'),
      el('div.chips',
        ...candidates.map((entry) =>
          el('button.chip.ghost', {
            onclick: () => {
              store.addStaple({ name: entry.label, unit: entry.unit, storeId: entry.storeId });
              toast(`${entry.label} als Vorlage gespeichert`);
            },
          }, '+ ', entry.label),
        ),
      ),
    );
  }

  return wrap;
}

let rerenderHook = () => {};
export function setRerender(fn) {
  rerenderHook = fn;
}
function rerender() {
  rerenderHook();
}

function editStaple(id) {
  const existing = id ? store.activeStaples().find((s) => s.id === id) : null;
  const isNew = !existing;

  sheet(isNew ? 'Neue Vorlage' : 'Vorlage bearbeiten', (body, close) => {
    const name = el('input', {
      type: 'text',
      value: existing?.name ?? '',
      placeholder: 'z. B. 2 l Milch',
    });
    const qty = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: existing?.qty ?? '' });
    const unit = el('select', ...[''].concat(UNITS).map((u) =>
      el('option', { value: u, selected: (existing?.unit ?? '') === u }, u || '–')));
    const storeSelect = el('select',
      el('option', { value: '', selected: !existing?.storeId }, 'Automatisch merken'),
      ...store.activeStores().map((laden) =>
        el('option', { value: laden.id, selected: laden.id === existing?.storeId }, laden.name)),
    );

    add(body, 
      field('Artikel', name),
      el('div.field-row', field('Menge', qty), field('Einheit', unit)),
      field('Laden', storeSelect),
      el('div.btn-row',
        existing
          ? el('button.btn.danger', {
              onclick: () => {
                store.removeStaple(existing.id);
                selected.delete(existing.id);
                close();
                toast('Vorlage gelöscht');
              },
            }, 'Löschen')
          : el('button.btn', { onclick: close }, 'Abbrechen'),
        el('button.btn.primary', {
          onclick: () => {
            const raw = name.value.trim();
            if (!raw) return;
            // Auch hier die Schnelleingabe erlauben: "2 l Milch"
            const parsed = parseLine(raw);
            const payload = {
              name: parsed.name,
              qty: qty.value === '' ? parsed.qty : Number(qty.value),
              unit: unit.value || parsed.unit || null,
              storeId: storeSelect.value || undefined,
            };
            if (existing) {
              store.updateStaple(existing.id, {
                ...payload,
                storeId: storeSelect.value || null,
              });
            } else {
              store.addStaple(payload);
            }
            close();
            toast('Gespeichert');
          },
        }, 'Speichern'),
      ),
    );
  });
}
