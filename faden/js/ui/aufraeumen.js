// Eingang aufraeumen: ein Element aufs Mal.
//
// Eine Liste mit dreissig unsortierten Zetteln ist genau die Wand,
// vor der man kehrtmacht. Deshalb zeigt der Aufraeum-Modus immer nur
// EINEN Eintrag und vier grosse Knoepfe. "Später" ist ausdruecklich
// erlaubt - besser drei Zettel einsortiert als keiner.
//
// Alles spielt sich in EINEM Blatt ab, auch die Zielwahl beim
// Anhaengen: shell.sheet() kennt keinen Stapel - ein zweites Blatt
// wuerde das erste samt laufender Runde aus dem DOM werfen.

import { add, el, clear, relativeDate, normalize, haptic } from '../util.js';
import * as store from '../state.js';
import { excerpt } from '../md.js';
import { toast, sheet } from './shell.js';
import { openNote } from './editor.js';

export function openAufraeumen() {
  // Die Warteschlange wird einmal beim Oeffnen aufgebaut. "Später"
  // schiebt ans Ende der Runde, statt den Eintrag sofort wieder
  // vorzulegen.
  const queue = store.inboxNotes().map((n) => n.id);
  if (!queue.length) {
    toast('Der Eingang ist leer ✨');
    return;
  }

  let done = 0;

  sheet('Eingang aufräumen', (body, close) => {
    const next = () => {
      const id = queue.shift();
      const note = id ? store.noteById(id) : null;
      if (!note || !note.inbox) {
        if (queue.length) return next();
        clear(body);
        add(body,
          el('div.empty',
            el('span.big', '✨'),
            el('div.bold', done ? `${done} einsortiert. Gut gemacht.` : 'Alles erledigt.'),
          ),
          el('button.btn.block', { onclick: close }, 'Fertig'),
        );
        return;
      }
      draw(note);
    };

    const step = () => {
      done += 1;
      haptic();
      next();
    };

    const draw = (note) => {
      clear(body);
      add(body,
        el('div.small.muted', `Noch ${queue.length + 1} im Eingang`),
        el('div.card.card-pad', {
          style: { margin: '10px 0 14px' },
          onclick: () => {
            close();
            openNote(note.id);
          },
        },
          el('div.bold', note.titel || 'Ohne Titel'),
          note.text ? el('div.small.muted', { style: { marginTop: '4px' } }, excerpt(note.text, 140)) : null,
          el('div.tiny.faint', { style: { marginTop: '6px' } }, `erfasst ${relativeDate(note.erstellt)}`),
        ),
        el('div.sortier-grid',
          bigBtn('📝', 'Behalten', 'bleibt als eigene Notiz', () => {
            store.updateNote(note.id, { inbox: false });
            step();
          }),
          bigBtn('🎯', 'Wird Projekt', 'mit eigenem nächsten Schritt', () => {
            store.updateNote(note.id, { typ: 'projekt', status: 'offen', inbox: false });
            step();
          }),
          bigBtn('📎', 'Anhängen an …', 'Text wandert in eine bestehende Notiz', () => {
            drawPicker(note);
          }),
          bigBtn('🗑', 'Weg damit', 'war nur ein Zwischengedanke', () => {
            store.removeNote(note.id);
            toast('Gelöscht', { action: 'Rückgängig', onAction: () => { store.restoreNote(note.id); } });
            step();
          }),
        ),
        el('button.btn.block', { style: { marginTop: '10px' }, onclick: () => { queue.push(note.id); next(); } },
          'Später entscheiden'),
      );
    };

    /** Zielnotiz waehlen - im selben Blatt, mit Weg zurueck. */
    const drawPicker = (note) => {
      clear(body);
      const input = el('input', { type: 'text', placeholder: 'Notiz oder Projekt suchen' });
      const list = el('div.card', { style: { marginTop: '10px' } });

      const drawList = () => {
        clear(list);
        const query = normalize(input.value);
        const candidates = store.activeNotes()
          .filter((n) => n.id !== note.id && !n.inbox)
          .filter((n) => !query || normalize(`${n.titel} ${n.tags.join(' ')}`).includes(query))
          .sort((a, b) => String(b.besucht ?? b.updatedAt).localeCompare(String(a.besucht ?? a.updatedAt)))
          .slice(0, 8);

        if (!candidates.length) {
          add(list, el('div.card-pad.small.muted', 'Nichts gefunden.'));
          return;
        }
        for (const target of candidates) {
          add(list,
            el('div.row.tappable', {
              onclick: () => {
                const block = note.text ? `${note.titel}\n${note.text}` : note.titel;
                store.updateNote(target.id, {
                  text: `${target.text ? `${target.text}\n\n` : ''}${block}`.trim(),
                });
                store.removeNote(note.id);
                toast(`In «${target.titel}» übernommen`);
                step();
              },
            },
              el('div.grow',
                el('div', target.titel || 'Ohne Titel'),
                el('div.tiny.faint', target.typ === 'projekt' ? 'Projekt' : relativeDate(target.updatedAt)),
              ),
              el('span.faint', '›'),
            ),
          );
        }
      };

      input.addEventListener('input', drawList);
      add(body,
        el('div.bold', `«${note.titel || 'Ohne Titel'}» anhängen an …`),
        el('div', { style: { margin: '10px 0' } }, input),
        list,
        el('button.btn.block', { style: { marginTop: '10px' }, onclick: () => draw(note) }, '‹ Zurück'),
      );
      drawList();
      setTimeout(() => input.focus(), 60);
    };

    next();
  });

  function bigBtn(icon, label, hint, onClick) {
    return el('button.sortier-btn', { onclick: onClick },
      el('span.big', icon),
      el('span.bold', label),
      el('span.tiny.muted', hint),
    );
  }
}
