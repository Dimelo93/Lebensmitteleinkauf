// Die Einkaufsliste: nach Läden gruppiert, in der Reihenfolge, in der
// eingekauft wird. Der Laden, in dem man gerade steht, rutscht nach oben.

import { add, el, formatAmount, formatMoney, colorFor, haptic } from '../util.js';
import { CATEGORIES, CATEGORY_ORDER, categoryIcon, categoryLabel, UNITS } from '../katalog.js';
import { parseInput, describeParsed } from '../parse.js';
import * as store from '../state.js';
import { toast, sheet, confirmSheet, emptyState, field } from './shell.js';

// Welcher Laden ist gerade in der Eingabeleiste erzwungen?
let forcedStoreId = null;

export const title = () => 'Einkauf';

export function subtitle() {
  const { open, done } = store.totals();
  if (!open && !done) return 'Liste ist leer';
  if (!open) return `${done} erledigt · fertig`;
  return `${open} offen${done ? ` · ${done} erledigt` : ''}`;
}

// ------------------------------------------------------------
// Hauptansicht
// ------------------------------------------------------------

export function render() {
  const state = store.getState();
  const groups = store.groupedList();
  const settings = state.settings;
  const { open, done, total, doneTotal } = store.totals();
  const wrap = el('div');

  if (!open && !done) {
    add(wrap, 
      emptyState('🧺', 'Noch nichts auf der Liste', 'Tipp unten ein, was du brauchst. Die App merkt sich beim nächsten Mal, in welchen Laden es gehört.'),
      suggestionChips(),
    );
    return wrap;
  }

  // Summenleiste
  if (settings.showPrices && (total > 0 || settings.budget)) {
    add(wrap, totalsBar(total, doneTotal, settings));
  }

  for (const group of groups) {
    if (!group.items.length) continue;
    add(wrap, storeSection(group, settings));
  }

  if (done > 0) {
    add(wrap, 
      el('div.btn-row', { style: { marginTop: '16px' } },
        el('button.btn.primary', {
          onclick: () => finishTrip(),
        }, `Einkauf abschliessen (${done})`),
      ),
      el('button.btn.block', {
        style: { marginBottom: '14px' },
        onclick: async () => {
          if (await confirmSheet('Erledigte löschen?', 'Die abgehakten Artikel verschwinden, ohne im Verlauf zu landen.', { confirmLabel: 'Löschen' })) {
            store.clearDone();
            toast('Erledigte entfernt');
          }
        },
      }, 'Erledigte nur löschen'),
    );
  }

  add(wrap, suggestionChips());
  return wrap;
}

function totalsBar(total, doneTotal, settings) {
  const budget = Number(settings.budget) || 0;
  const over = budget > 0 && total > budget;
  return el('div.totals',
    el('div.grow',
      el('div.small.muted', budget > 0
        ? `Budget ${formatMoney(budget, settings.currency)}${over ? ' – überschritten' : ''}`
        : 'Summe der Liste'),
      el('div', { class: `sum${over ? ' over' : ''}` }, formatMoney(total, settings.currency)),
    ),
    doneTotal > 0
      ? el('div.right.center',
          el('div.tiny.muted', 'davon im Wagen'),
          el('div.bold', formatMoney(doneTotal, settings.currency)),
        )
      : null,
  );
}

function storeSection(group, settings) {
  const { store: laden, open, done } = group;
  // Achtung: die Sammelgruppe "Noch kein Laden" hat die id null - ohne
  // die erste Prüfung wäre sie immer als aktueller Laden markiert.
  const isActive = Boolean(laden.id) && settings.activeStoreId === laden.id;

  const card = el('div.card');
  add(card, 
    el('div', {
      class: `store-head${isActive ? ' is-active' : ''}`,
      onclick: () => laden.id && store.setActiveStore(laden.id),
    },
      el('div.dot', { style: { background: laden.color || colorFor(laden.name) } }),
      el('div.grow',
        el('div.name', laden.name),
        el('div.count', `${open.length} offen${done.length ? ` · ${done.length} erledigt` : ''}${settings.showPrices && group.total ? ` · ${formatMoney(group.total, settings.currency)}` : ''}`),
      ),
      isActive ? el('span.tag.belegt', 'hier') : null,
    ),
  );

  // Offene Artikel, optional nach Abteilung gruppiert
  if (settings.groupByCategory) {
    const byCategory = new Map();
    for (const item of open) {
      const key = item.category || 'sonstiges';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(item);
    }
    const sorted = [...byCategory.entries()].sort((a, b) => (CATEGORY_ORDER[a[0]] ?? 99) - (CATEGORY_ORDER[b[0]] ?? 99));
    for (const [category, items] of sorted) {
      if (sorted.length > 1) add(card, el('div.cat-head', `${categoryIcon(category)} ${categoryLabel(category)}`));
      for (const item of items) add(card, itemRow(item, settings));
    }
  } else {
    for (const item of open) add(card, itemRow(item, settings));
  }

  if (!settings.hideDone) {
    for (const item of done) add(card, itemRow(item, settings));
  }

  return card;
}

function itemRow(item, settings) {
  const amount = formatAmount(item.qty, item.unit);
  const row = el('div', { class: `item${item.done ? ' done' : ''}` });

  add(row, 
    el('button.check', {
      'aria-label': item.done ? 'Wieder offen' : 'Abhaken',
      onclick: (event) => {
        event.stopPropagation();
        haptic();
        store.toggleItem(item.id);
      },
    }, '✓'),
    el('div.label', {
      onclick: () => {
        haptic();
        store.toggleItem(item.id);
      },
    },
      el('span.name', item.name),
      amount || item.note ? el('div.meta', [amount, item.note].filter(Boolean).join(' · ')) : null,
    ),
    settings.showPrices && item.price != null ? el('div.price', formatMoney(item.price, settings.currency)) : null,
    el('button.edit-btn', {
      'aria-label': 'Bearbeiten',
      onclick: (event) => {
        event.stopPropagation();
        editItem(item.id);
      },
    }, '⋯'),
  );

  return row;
}

// ------------------------------------------------------------
// Vorschläge häufiger Artikel
// ------------------------------------------------------------

function suggestionChips() {
  const suggestions = store.frequentSuggestions(10);
  if (!suggestions.length) return el('div');

  return el('div',
    el('div.section-title', 'Kaufst du oft'),
    el('div.chips',
      ...suggestions.map((entry) =>
        el('button.chip.ghost', {
          onclick: () => {
            store.addItem({ name: entry.label, storeId: entry.storeId, unit: entry.unit, category: entry.category });
            toast(`${entry.label} hinzugefügt`);
          },
        }, '+ ', entry.label),
      ),
    ),
  );
}

// ------------------------------------------------------------
// Eingabeleiste
// ------------------------------------------------------------

export function addbar() {
  const stores = store.activeStores();
  const wrap = el('div.addbar');

  const preview = el('div.hint-row');
  const input = el('input', {
    type: 'text',
    placeholder: 'z. B. 2 kg Rüebli, Milch, Brot',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    'aria-label': 'Artikel hinzufügen',
  });

  const submit = el('button.go', { type: 'submit', 'aria-label': 'Hinzufügen', disabled: true }, '+');

  const form = el('form', {
    onsubmit: (event) => {
      event.preventDefault();
      const parsed = parseInput(input.value);
      if (!parsed.length) return;

      const names = [];
      for (const entry of parsed) {
        const item = store.addItem({
          name: entry.name,
          qty: entry.qty,
          unit: entry.unit,
          price: entry.price,
          ...(forcedStoreId !== null ? { storeId: forcedStoreId } : {}),
        });
        if (item) names.push(item.name);
      }

      input.value = '';
      submit.disabled = true;
      renderPreview();
      haptic(12);
      if (names.length) {
        const last = names[names.length - 1];
        toast(names.length === 1 ? `${last} hinzugefügt` : `${names.length} Artikel hinzugefügt`);
      }
      input.focus();
    },
  }, input, submit);

  function renderPreview() {
    preview.replaceChildren();
    const raw = input.value.trim();
    if (!raw) return;

    const parsed = parseInput(raw);
    for (const entry of parsed.slice(0, 3)) {
      const known = store.recall(entry.name);
      const targetId = forcedStoreId !== null ? forcedStoreId : known?.storeId ?? null;
      const target = store.storeById(targetId);
      const bits = [entry.name];
      const detail = describeParsed(entry);
      if (detail) bits.push(detail);
      add(preview, 
        el('span.chip', { style: { padding: '4px 10px', fontSize: '12px' } },
          bits.join(' · '),
          el('span.faint', ' → ', target ? target.name : 'kein Laden'),
        ),
      );
    }
  }

  input.addEventListener('input', () => {
    submit.disabled = !input.value.trim();
    renderPreview();
  });

  // Ladenwahl: "Automatisch" nutzt das Gedächtnis, ein gewählter Laden
  // überschreibt es für die nächsten Eingaben.
  const chips = el('div.chips');
  const paint = () => {
    chips.replaceChildren(
      el('button.chip', {
        type: 'button',
        class: forcedStoreId === null ? 'chip on' : 'chip',
        onclick: () => {
          forcedStoreId = null;
          paint();
          renderPreview();
        },
      }, '✨ Automatisch'),
      ...stores.map((laden) =>
        el('button.chip', {
          type: 'button',
          class: forcedStoreId === laden.id ? 'chip on' : 'chip',
          onclick: () => {
            forcedStoreId = forcedStoreId === laden.id ? null : laden.id;
            paint();
            renderPreview();
          },
        },
          el('span.dot', { style: { background: laden.color || colorFor(laden.name) } }),
          laden.name,
        ),
      ),
    );
  };
  paint();

  add(wrap, chips, preview, form);
  return wrap;
}

// ------------------------------------------------------------
// Artikel bearbeiten
// ------------------------------------------------------------

export function editItem(id) {
  const item = store.getState().items.find((i) => i.id === id);
  if (!item) return;
  const settings = store.getState().settings;

  sheet('Artikel bearbeiten', (body, close) => {
    const name = el('input', { type: 'text', value: item.name });
    const qty = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: item.qty ?? '' });
    const unit = el('select', ...[''].concat(UNITS).map((u) =>
      el('option', { value: u, selected: (item.unit ?? '') === u }, u || '–')));
    const price = el('input', { type: 'number', inputmode: 'decimal', step: '0.05', value: item.price ?? '', placeholder: settings.currency });
    const note = el('input', { type: 'text', value: item.note ?? '', placeholder: 'z. B. Aktion, Marke, für Sonntag' });

    const storeSelect = el('select',
      el('option', { value: '', selected: !item.storeId }, 'Noch kein Laden'),
      ...store.activeStores().map((laden) =>
        el('option', { value: laden.id, selected: laden.id === item.storeId }, laden.name)),
    );

    const categorySelect = el('select',
      ...CATEGORIES.map((category) =>
        el('option', { value: category.id, selected: category.id === item.category }, `${category.icon} ${category.label}`)),
    );

    add(body, 
      field('Artikel', name),
      el('div.field-row', field('Menge', qty), field('Einheit', unit)),
      field(`Preis (${settings.currency})`, price),
      field('Laden', storeSelect),
      field('Abteilung', categorySelect),
      field('Notiz', note),
      el('div.btn-row',
        el('button.btn.danger', {
          onclick: async () => {
            close();
            const removed = { ...item };
            store.removeItem(item.id);
            toast(`${removed.name} gelöscht`, {
              action: 'Rückgängig',
              onAction: () => store.restoreItem(removed.id),
            });
          },
        }, 'Löschen'),
        el('button.btn.primary', {
          onclick: () => {
            store.updateItem(item.id, {
              name: name.value.trim() || item.name,
              qty: qty.value === '' ? null : Number(qty.value),
              unit: unit.value || null,
              price: price.value === '' ? null : Number(price.value),
              note: note.value.trim() || null,
              storeId: storeSelect.value || null,
              category: categorySelect.value,
            });
            close();
            toast('Gespeichert');
          },
        }, 'Speichern'),
      ),
    );
  });
}

// ------------------------------------------------------------
// Einkauf abschliessen
// ------------------------------------------------------------

function finishTrip() {
  const settings = store.getState().settings;
  const done = store.activeItems().filter((i) => i.done);
  const withoutPrice = done.filter((i) => i.price == null);

  sheet('Einkauf abschliessen', (body, close) => {
    const sum = done.reduce((acc, i) => acc + (Number(i.price) || 0), 0);

    add(body, 
      el('p.muted', { style: { marginTop: 0 } },
        `${done.length} Artikel wandern in den Verlauf. Erfasste Preise landen im Preisgedächtnis und machen den Ladenvergleich genauer.`),
    );

    if (settings.showPrices && withoutPrice.length) {
      add(body, el('div.section-title', `Preis nachtragen (${withoutPrice.length} offen)`));
      const card = el('div.card');
      for (const item of withoutPrice) {
        const input = el('input', {
          type: 'number',
          inputmode: 'decimal',
          step: '0.05',
          placeholder: settings.currency,
          style: { width: '96px', minHeight: '38px', textAlign: 'right' },
          onchange: () => {
            store.updateItem(item.id, { price: input.value === '' ? null : Number(input.value) });
          },
        });
        add(card, 
          el('div.row',
            el('div.grow',
              el('div', item.name),
              el('div.small.muted', store.storeById(item.storeId)?.name ?? 'Ohne Laden'),
            ),
            input,
          ),
        );
      }
      add(body, card);
    }

    add(body, 
      el('div.totals', { style: { marginTop: '4px' } },
        el('div.grow', el('div.small.muted', 'Bisher erfasst'), el('div.sum', formatMoney(sum, settings.currency))),
      ),
      el('div.btn-row',
        el('button.btn', { onclick: close }, 'Abbrechen'),
        el('button.btn.primary', {
          onclick: () => {
            const trip = store.finishTrip();
            close();
            if (trip) toast(`Einkauf gespeichert · ${formatMoney(trip.total, settings.currency)}`);
          },
        }, 'Abschliessen'),
      ),
    );
  });
}
