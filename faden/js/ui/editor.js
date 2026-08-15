// Der Notiz-Editor: Lesen, Schreiben, Verlinken.
//
// Ein Vollbild-Panel mit zwei Zustaenden. Lesen zeigt das gerenderte
// Markdown mit klickbaren [[Verlinkungen]]; Schreiben ist ein
// Textfeld, das von selbst speichert - einen Speichern-Knopf, den
// man vergessen kann, gibt es absichtlich nicht.

import { add, el, clear, debounce, relativeDate, normalize, haptic } from '../util.js';
import * as store from '../state.js';
import { renderMarkdown, toggleTaskLine, excerpt } from '../md.js';
import { toast, panel, sheet, confirmSheet, field } from './shell.js';

// Wohin ein Tipp auf einen #tag fuehrt, entscheidet app.js (Wechsel
// auf die Notizen-Ansicht mit gesetztem Filter). Der Editor kennt
// die Tabs nicht.
let tagHandler = () => {};
export function setTagHandler(fn) {
  tagHandler = fn;
}

let openPanel = null;

// Der ausstehende, entprellte Speichervorgang des Editors. Wird bei
// jedem Moduswechsel und beim Schliessen sofort ausgefuehrt - sonst
// zeigt die Ansicht den Stand von vor 400 ms, und zwei schnelle
// Tipps hintereinander koennten die letzten Zeichen verlieren.
let pendingSave = null;
function flushPendingSave() {
  pendingSave?.flush();
  pendingSave = null;
}

/** Von ueberall aufrufbar: Notiz oeffnen, im Faden vermerken. */
export function openNote(noteId, { edit = false } = {}) {
  const note = store.noteById(noteId);
  if (!note) return;
  store.visit(noteId);

  openPanel?.close();
  openPanel = panel((body, close) => {
    draw(body, close, noteId, { edit });
  }, { onClose: () => { flushPendingSave(); openPanel = null; } });
}

/**
 * Eine [[Verlinkung]] verfolgen. Gibt es die Notiz noch nicht, wird
 * sie angelegt - so waechst das Netz beim Schreiben, wie in Obsidian.
 */
export function openByTitle(titel) {
  let note = store.noteByTitle(titel);
  if (!note) {
    note = store.addNote({ titel: titel.trim(), inbox: false });
    toast(`«${note.titel}» angelegt`);
  }
  openNote(note.id, { edit: !note.text });
}

// ------------------------------------------------------------
// Aufbau
// ------------------------------------------------------------

function draw(body, close, noteId, { edit }) {
  flushPendingSave();
  clear(body);
  const note = store.noteById(noteId);
  if (!note) {
    close();
    return;
  }

  const hooks = {
    onWikiLink: (titel) => openByTitle(titel),
    onTag: (tag) => {
      close();
      tagHandler(tag);
    },
    onToggleTask: (lineIndex, checked) => {
      haptic();
      store.updateNote(note.id, { text: toggleTaskLine(note.text, lineIndex, checked) });
      draw(body, close, noteId, { edit: false });
    },
  };

  // ---------- Kopfleiste ----------
  add(body,
    el('div.panel-top',
      el('button.panel-btn', { onclick: close }, '‹ Fertig'),
      el('div.grow'),
      edit
        ? el('button.panel-btn.strong', { onclick: () => draw(body, close, noteId, { edit: false }) }, 'Ansehen')
        : el('button.panel-btn.strong', { onclick: () => draw(body, close, noteId, { edit: true }) }, 'Bearbeiten'),
      el('button.panel-btn', { onclick: () => menuSheet(note, body, close, noteId) }, '⋯'),
    ),
  );

  const scroll = el('div.panel-scroll');
  add(body, scroll);

  // ---------- Eingang-Hinweis ----------
  if (note.inbox) {
    add(scroll,
      el('div.inbox-note',
        el('span', '📥 Liegt im Eingang'),
        el('button.btn.small-btn', {
          onclick: () => {
            store.updateNote(note.id, { inbox: false });
            toast('Einsortiert');
            draw(body, close, noteId, { edit });
          },
        }, 'Behalten'),
      ),
    );
  }

  if (edit) drawEdit(scroll, note);
  else drawView(scroll, note, hooks, () => draw(body, close, noteId, { edit: false }), close);
}

// ---------- Lesen ----------

function drawView(scroll, note, hooks, redraw, closePanel) {
  add(scroll, el('h1.note-title', note.titel || 'Ohne Titel'));

  add(scroll,
    el('div.note-meta',
      typLabel(note),
      el('span.faint', ` · ${relativeDate(note.updatedAt)}`),
      note.tags.length ? el('span.faint', ` · ${note.tags.map((t) => `#${t}`).join(' ')}`) : null,
    ),
  );

  // Projekte: der eine naechste kleine Schritt, direkt ueber dem Text.
  if (note.typ === 'projekt') {
    add(scroll, nextStepCard(note, redraw, closePanel));
  }

  if (note.text) {
    add(scroll, renderMarkdown(note.text, hooks));
  } else {
    add(scroll, el('p.faint', 'Noch kein Inhalt. Tipp oben auf «Bearbeiten».'));
  }

  // ---------- Backlinks ----------
  const links = store.backlinks(note);
  if (links.length) {
    add(scroll, el('div.section-title', `Verweist hierher (${links.length})`));
    const card = el('div.card');
    for (const other of links) {
      add(card,
        el('div.row.tappable', { onclick: () => openNote(other.id) },
          el('div.grow',
            el('div', other.titel || 'Ohne Titel'),
            el('div.small.muted', excerpt(other.text, 70)),
          ),
          el('span.faint', '›'),
        ),
      );
    }
    add(scroll, card);
  }
}

function nextStepCard(note, redraw, closePanel) {
  const card = el('div.card.card-pad.next-step');
  if (note.naechster) {
    add(card,
      el('div.small.muted', 'Nächster kleiner Schritt'),
      el('div.bold', { style: { margin: '4px 0 10px' } }, note.naechster),
      el('div.btn-row', { style: { marginBottom: 0 } },
        el('button.btn', { onclick: () => askNextStep(note, redraw) }, 'Ändern'),
        el('button.btn.primary', {
          onclick: () => {
            store.startFokus(note.id);
            haptic();
            // Den Editor schliessen: sein Panel (z-50) laege sonst
            // ueber dem Fokus-Overlay (z-40), und der Knopf saehe
            // aus, als taete er nichts.
            closePanel?.();
          },
        }, 'Fokus starten'),
      ),
    );
  } else {
    add(card,
      el('div.small.muted', 'Dieses Projekt hat noch keinen nächsten Schritt.'),
      el('button.btn.block', { style: { marginTop: '8px' }, onclick: () => askNextStep(note, redraw) },
        'Nächsten kleinen Schritt festlegen'),
    );
  }
  return card;
}

function askNextStep(note, redraw) {
  sheet('Nächster kleiner Schritt', (sheetBody, closeSheet) => {
    const input = el('input', {
      type: 'text',
      value: note.naechster ?? '',
      placeholder: 'so klein, dass er heute machbar ist',
    });
    add(sheetBody,
      el('p.small.muted', { style: { marginTop: 0 } },
        'Ein Schritt, nicht drei. «Mail an Vermieter schreiben», nicht «Umzug organisieren».'),
      field('Schritt', input),
      el('div.btn-row',
        el('button.btn', { onclick: closeSheet }, 'Abbrechen'),
        el('button.btn.primary', {
          onclick: () => {
            store.updateNote(note.id, { naechster: input.value.trim() || null });
            closeSheet();
            redraw();
          },
        }, 'Speichern'),
      ),
    );
    setTimeout(() => input.focus(), 60);
  });
}

// ---------- Schreiben ----------

function drawEdit(scroll, note) {
  const isJournal = note.typ === 'journal';

  const titleInput = el('input.note-title-input', {
    type: 'text',
    value: note.titel,
    placeholder: 'Titel',
    // Der Titel der Tagesnotiz ist das Datum - daran haengt die
    // Wiederauffindbarkeit, deshalb nicht editierbar.
    readOnly: isJournal,
  });

  const textInput = el('textarea.note-text-input', {
    placeholder: 'Schreib einfach los. [[Titel]] verlinkt, #tag markiert, - [ ] wird ein Häkchen.',
  });
  textInput.value = note.text;

  // Autovervollstaendigung fuer [[ - erscheint als Chip-Zeile,
  // sobald hinter dem Cursor eine offene Verlinkung steht.
  const suggest = el('div.chips.suggest');

  // dirty verhindert, dass der Flush ohne echte Aenderung speichert -
  // sonst wuerde schon Oeffnen und Schliessen einer Notiz ihren
  // Zeitstempel hochzaehlen und Sync-Verkehr ausloesen.
  let dirty = false;
  const save = debounce(() => {
    dirty = false;
    store.updateNote(note.id, { titel: titleInput.value.trim() || note.titel, text: textInput.value });
  }, 400);
  // Fuer den Flush bei Moduswechsel und Schliessen vormerken.
  pendingSave = { flush: () => { if (dirty) save.flush(); } };

  titleInput.addEventListener('input', () => {
    dirty = true;
    save();
  });
  textInput.addEventListener('input', () => {
    dirty = true;
    save();
    updateSuggest();
  });
  textInput.addEventListener('click', updateSuggest);
  textInput.addEventListener('keyup', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) updateSuggest();
  });

  function updateSuggest() {
    clear(suggest);
    const upto = textInput.value.slice(0, textInput.selectionStart);
    const open = upto.match(/\[\[([^\[\]\n]*)$/);
    if (!open) return;

    const query = normalize(open[1]);
    const matches = store.activeNotes()
      .filter((n) => n.titel && (!query || normalize(n.titel).includes(query)))
      .sort((a, b) => String(b.besucht ?? b.updatedAt).localeCompare(String(a.besucht ?? a.updatedAt)))
      .slice(0, 6);

    for (const match of matches) {
      add(suggest, el('button.chip', {
        onclick: () => {
          const start = textInput.selectionStart - open[1].length;
          const after = textInput.value.slice(textInput.selectionStart);
          const closing = after.startsWith(']]') ? '' : ']]';
          textInput.value = `${textInput.value.slice(0, start)}${match.titel}${closing}${after}`;
          const cursor = start + match.titel.length + closing.length + (closing ? 0 : 2);
          textInput.setSelectionRange(cursor, cursor);
          textInput.focus();
          clear(suggest);
          dirty = true;
          save();
        },
      }, `[[${match.titel}]]`));
    }
  }

  add(scroll, titleInput, suggest, textInput);
  // Beim Oeffnen einer leeren Notiz direkt lostippen koennen.
  if (!note.text && !isJournal) setTimeout(() => (note.titel ? textInput : titleInput).focus(), 60);
}

// ---------- Menue ----------

function typLabel(note) {
  if (note.typ === 'projekt') {
    return el('span.tag', note.status === 'fertig' ? 'Projekt · fertig' : 'Projekt');
  }
  if (note.typ === 'journal') return el('span.tag', 'Tagesnotiz');
  return el('span.tag', 'Notiz');
}

function menuSheet(note, body, close, noteId) {
  sheet(null, (sheetBody, closeSheet) => {
    const redraw = () => draw(body, close, noteId, { edit: false });
    const card = el('div.card');

    if (note.typ !== 'journal') {
      add(card,
        el('div.row.tappable', {
          onclick: () => {
            store.updateNote(note.id, { angeheftet: !note.angeheftet });
            closeSheet();
            redraw();
          },
        }, el('div.grow', note.angeheftet ? 'Nicht mehr anheften' : 'Anheften'), el('span.faint', '📌')),
      );

      const istProjekt = note.typ === 'projekt';
      add(card,
        el('div.row.tappable', {
          onclick: () => {
            store.updateNote(note.id, istProjekt
              ? { typ: 'notiz', status: null }
              : { typ: 'projekt', status: 'offen', inbox: false });
            closeSheet();
            redraw();
            toast(istProjekt ? 'Ist jetzt eine Notiz' : 'Ist jetzt ein Projekt');
          },
        }, el('div.grow', istProjekt ? 'In Notiz umwandeln' : 'Zum Projekt machen'), el('span.faint', '🎯')),
      );

      if (istProjekt) {
        const fertig = note.status === 'fertig';
        add(card,
          el('div.row.tappable', {
            onclick: () => {
              store.updateNote(note.id, { status: fertig ? 'offen' : 'fertig', naechster: fertig ? note.naechster : null });
              closeSheet();
              redraw();
              if (!fertig) toast('Projekt abgeschlossen 🎉');
            },
          }, el('div.grow', fertig ? 'Wieder öffnen' : 'Als fertig markieren'), el('span.faint', '✅')),
        );
      }
    }

    add(card,
      el('div.row.tappable', {
        onclick: async () => {
          closeSheet();
          const ok = await confirmSheet('Notiz löschen?', `«${note.titel || 'Ohne Titel'}» wird gelöscht.`);
          if (!ok) return;
          store.removeNote(note.id);
          close();
          toast('Gelöscht', { action: 'Rückgängig', onAction: () => store.restoreNote(note.id) });
        },
      }, el('div.grow', { style: { color: 'var(--danger)' } }, 'Löschen')),
    );

    add(sheetBody, card);
  });
}
