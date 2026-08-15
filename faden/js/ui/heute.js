// Heute: der Anker des Tages.
//
// Die Ansicht beantwortet die eine Frage, mit der ein zerstreuter
// Kopf zurueckkommt: "Wo war ich?" Oben die Tagesnotiz, darunter
// Weitermachen (zuletzt beruehrte Notizen), die naechsten kleinen
// Schritte der Projekte, der Eingang und der Faden des Tages.

import { add, el, relativeDate, haptic } from '../util.js';
import * as store from '../state.js';
import { renderMarkdown, excerpt } from '../md.js';
import { emptyState, sheet } from './shell.js';
import { openNote, openByTitle } from './editor.js';
import { openAufraeumen } from './aufraeumen.js';
import { captureBar } from './erfassen.js';

let tagHandler = () => {};
export function setTagHandler(fn) {
  tagHandler = fn;
}

export const title = () => 'Heute';

export function subtitle() {
  return new Date().toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const addbar = () => captureBar('Was ist dir im Kopf? Einfach abladen …');

export function render() {
  const wrap = el('div');
  const inbox = store.inboxNotes();

  // ---------- Tagesnotiz ----------
  // Erst beim Antippen anlegen: sonst entstuende an jedem Tag, an dem
  // man die App nur kurz oeffnet, eine leere Journal-Notiz.
  const heute = store.activeNotes().find((n) => n.typ === 'journal' && n.titel === todayTitle());
  add(wrap, el('div.section-title', 'Tagesnotiz'));
  const tagesCard = el('div.card.card-pad.tappable-card', {
    onclick: () => {
      const note = store.todayNote();
      openNote(note.id, { edit: !note.text });
    },
  });
  if (heute?.text) {
    add(tagesCard, renderMarkdown(heute.text, {
      onWikiLink: (titel) => openByTitle(titel),
      onTag: (tag) => tagHandler(tag),
    }));
  } else {
    add(tagesCard, el('div.muted', 'Noch leer. Tipp hier, um den Tag festzuhalten.'));
  }
  add(wrap, tagesCard);

  // ---------- Weitermachen ----------
  const recent = store.recentNotes(5);
  if (recent.length) {
    add(wrap, el('div.section-title', 'Weitermachen'));
    const card = el('div.card');
    for (const note of recent) {
      add(card,
        el('div.row.tappable', { onclick: () => openNote(note.id) },
          el('div.grow',
            el('div', note.titel || 'Ohne Titel'),
            el('div.small.muted', `zuletzt ${relativeDate(note.besucht)}`),
          ),
          el('span.faint', '›'),
        ),
      );
    }
    add(wrap, card);
  }

  // ---------- Naechste kleine Schritte ----------
  const steps = store.projects().filter((p) => p.naechster);
  if (steps.length) {
    add(wrap, el('div.section-title', 'Nächste kleine Schritte'));
    const card = el('div.card');
    for (const project of steps) {
      add(card,
        el('div.row.tappable', { onclick: () => openNote(project.id) },
          el('div.grow',
            el('div', project.naechster),
            el('div.small.muted', project.titel),
          ),
          el('button.fokus-go', {
            'aria-label': `Fokus auf ${project.titel}`,
            onclick: (event) => {
              event.stopPropagation();
              haptic();
              store.startFokus(project.id);
            },
          }, '▶'),
        ),
      );
    }
    add(wrap, card);
  }

  // ---------- Eingang ----------
  add(wrap, el('div.section-title', 'Eingang'));
  if (inbox.length) {
    add(wrap,
      el('div.card',
        el('div.row.tappable', { onclick: openAufraeumen },
          el('div.grow',
            el('div', `${inbox.length} ${inbox.length === 1 ? 'Zettel wartet' : 'Zettel warten'}`),
            el('div.small.muted', 'Einer aufs Mal – dauert eine Minute.'),
          ),
          el('span.badge', String(inbox.length)),
          el('span.faint', '›'),
        ),
      ),
    );
  } else {
    add(wrap, el('div.card', el('div.card-pad.small.muted', 'Leer ✨ – alles einsortiert.')));
  }

  // ---------- Der Faden ----------
  const trail = store.todayTrail();
  if (trail.length > 1) {
    add(wrap, el('div.section-title', 'Dein Faden heute'));
    add(wrap,
      el('div.card',
        el('div.row.tappable', { onclick: () => trailSheet() },
          el('div.grow',
            el('div', `${trail.length} Stationen`),
            el('div.small.muted', trail.slice(-3).map((s) => s.note.titel || 'Ohne Titel').join(' → ')),
          ),
          el('span.faint', '›'),
        ),
      ),
    );
  }

  // ---------- Heute erfasst ----------
  const captured = store.capturedToday();
  if (captured.length) {
    add(wrap, el('div.section-title', 'Heute erfasst'));
    const card = el('div.card');
    for (const note of captured.slice(0, 8)) {
      add(card,
        el('div.row.tappable', { onclick: () => openNote(note.id) },
          el('div.grow',
            el('div', note.titel || 'Ohne Titel'),
            note.text ? el('div.small.muted', excerpt(note.text, 70)) : null,
          ),
          note.inbox ? el('span.tag', 'Eingang') : null,
        ),
      );
    }
    add(wrap, card);
  }

  if (!recent.length && !steps.length && !inbox.length && !captured.length && !heute?.text) {
    add(wrap, emptyState('🧵', 'Schön leer hier.',
      'Tipp unten ins Feld und lad ab, was dir im Kopf herumgeht. Sortiert wird später – oder nie.'));
  }

  return wrap;
}

function todayTitle() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Der ganze Faden von heute, aeltester Halt zuerst - zum Zurueckspringen. */
function trailSheet() {
  sheet('Dein Faden heute', (body, close) => {
    const trail = store.todayTrail();
    const card = el('div.card');
    for (const step of [...trail].reverse()) {
      add(card,
        el('div.row.tappable', {
          onclick: () => {
            close();
            openNote(step.note.id);
          },
        },
          el('div.grow',
            el('div', step.note.titel || 'Ohne Titel'),
            el('div.tiny.faint', new Date(step.at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })),
          ),
          el('span.faint', '›'),
        ),
      );
    }
    add(body,
      el('p.small.muted', { style: { marginTop: 0 } },
        'Jede Notiz, die du heute geöffnet hast, in Reihenfolge – die jüngste zuoberst. Springen ist erlaubt, der Weg zurück steht hier.'),
      card,
    );
  });
}
