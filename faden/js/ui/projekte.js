// Projekte: wenige, sichtbar, jedes mit genau einem naechsten Schritt.
//
// Die Liste zeigt nicht den Berg (alle Aufgaben), sondern die Tuer
// hinein: den einen Schritt pro Projekt. Ein Projekt ohne Schritt
// wird deutlich markiert - genau diese Projekte bleiben sonst
// monatelang liegen.

import { add, el, relativeDate, haptic } from '../util.js';
import * as store from '../state.js';
import { emptyState, toggleRow } from './shell.js';
import { openNote } from './editor.js';
import { captureBar } from './erfassen.js';

export const title = () => 'Projekte';

export function subtitle() {
  const open = store.projects().length;
  return open === 1 ? '1 offenes Projekt' : `${open} offene Projekte`;
}

export const addbar = () => captureBar('Neues Projekt …', { typ: 'projekt' });

export function render() {
  const wrap = el('div');
  const open = store.projects();

  if (!open.length) {
    add(wrap, emptyState('🎯', 'Kein offenes Projekt.',
      'Unten eintippen, was du vorhast. Danach fragt dich die App nur noch eines: Was ist der nächste kleine Schritt?'));
  } else {
    const card = el('div.card');
    for (const project of open) {
      add(card,
        el('div.row.tappable', { onclick: () => openNote(project.id) },
          el('div.grow',
            el('div', project.angeheftet ? '📌 ' : '', project.titel || 'Ohne Titel'),
            project.naechster
              ? el('div.small.muted', `→ ${project.naechster}`)
              : el('div.small', { style: { color: 'var(--warn)' } }, 'Kein nächster Schritt – antippen und einen setzen'),
          ),
          project.naechster
            ? el('button.fokus-go', {
              'aria-label': `Fokus auf ${project.titel}`,
              onclick: (event) => {
                event.stopPropagation();
                haptic();
                store.startFokus(project.id);
              },
            }, '▶')
            : null,
        ),
      );
    }
    add(wrap, card);
  }

  // ---------- Fertige ----------
  const fertige = store.activeNotes()
    .filter((n) => n.typ === 'projekt' && n.status === 'fertig')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  if (fertige.length) {
    add(wrap, el('div.section-title', 'Fertig'));
    const settings = store.getState().settings;
    add(wrap,
      el('div.card',
        toggleRow('Fertige anzeigen', `${fertige.length} abgeschlossen`, settings.zeigeFertigeProjekte,
          (value) => store.updateSettings({ zeigeFertigeProjekte: value })),
      ),
    );
    if (settings.zeigeFertigeProjekte) {
      const card = el('div.card');
      for (const project of fertige) {
        add(card,
          el('div.row.tappable', { onclick: () => openNote(project.id) },
            el('div.grow',
              el('div', { style: { color: 'var(--text-dim)' } }, '✅ ', project.titel),
              el('div.tiny.faint', relativeDate(project.updatedAt)),
            ),
            el('span.faint', '›'),
          ),
        );
      }
      add(wrap, card);
    }
  }

  return wrap;
}
