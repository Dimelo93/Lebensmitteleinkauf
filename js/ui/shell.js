// Gemeinsame Bausteine der Oberfläche: Hinweise, Blätter, Rückfragen.

import { add, el, clear } from '../util.js';

let toastTimer = null;

/**
 * Kurzer Hinweis am unteren Rand. Mit action wird daraus ein
 * Rückgängig-Knopf - wichtig beim versehentlichen Löschen.
 */
export function toast(message, { action = null, onAction = null, ms = 3200 } = {}) {
  const node = document.getElementById('toast');
  clear(node);
  add(node, document.createTextNode(message));
  if (action && onAction) {
    add(node, 
      el('button', {
        onclick: () => {
          hideToast();
          onAction();
        },
      }, action),
    );
  }
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  document.getElementById('toast').classList.remove('show');
}

/**
 * Blatt von unten. Gibt ein Objekt mit close() zurück; der Inhalt wird
 * über eine Aufbaufunktion geliefert, die close() bekommt.
 */
export function sheet(title, build, { onDismiss = null } = {}) {
  const slot = document.getElementById('sheet-slot');
  clear(slot);

  const body = el('div');
  const panel = el('div.sheet', el('div.grip'), title ? el('h2', title) : null, body);
  const backdrop = el('div.sheet-bg', panel);

  const close = () => {
    slot.contains(backdrop) && slot.removeChild(backdrop);
    document.body.style.overflow = '';
  };

  // Tippen neben das Blatt schliesst es. Der Rückruf ist wichtig für
  // Rückfragen: sonst wartet der Aufrufer ewig auf eine Antwort, die
  // nie kommt.
  backdrop.addEventListener('click', (event) => {
    if (event.target !== backdrop) return;
    close();
    onDismiss?.();
  });
  panel.addEventListener('click', (event) => event.stopPropagation());

  document.body.style.overflow = 'hidden';
  add(slot, backdrop);
  build(body, close);

  // Erstes Eingabefeld fokussieren, aber nicht auf iOS beim Öffnen
  // per Tap - sonst springt die Tastatur hoch und verdeckt alles.
  return { close, panel, body };
}

/** Rückfrage vor unumkehrbaren Aktionen. */
export function confirmSheet(title, text, { confirmLabel = 'Löschen', danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    sheet(title, (body, close) => {
      add(body,
        el('p.muted', { style: { marginTop: 0 } }, text),
        el('div.btn-row',
          el('button.btn', {
            onclick: () => {
              close();
              answer(false);
            },
          }, 'Abbrechen'),
          el(`button.btn${danger ? '.danger' : '.primary'}`, {
            onclick: () => {
              close();
              answer(true);
            },
          }, confirmLabel),
        ),
      );
    }, { onDismiss: () => answer(false) });
  });
}

export function emptyState(icon, title, text) {
  return el('div.empty',
    el('span.big', icon),
    el('div.bold', title),
    text ? el('div.small.muted', { style: { marginTop: '6px' } }, text) : null,
  );
}

/** Ein-/Aus-Schalter im iOS-Stil. */
export function toggleRow(label, description, value, onChange) {
  const knob = el('div', { class: `switch${value ? ' on' : ''}` });
  return el('div.switch-row', {
    onclick: () => {
      const next = !knob.classList.contains('on');
      knob.classList.toggle('on', next);
      onChange(next);
    },
  },
    el('div.grow',
      el('div', label),
      description ? el('div.small.muted', description) : null,
    ),
    knob,
  );
}

export function field(label, input) {
  return el('div.field', el('label', label), input);
}
