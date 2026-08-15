// Alle Notizen: Suche, Filter, Liste.
//
// Die Suche filtert beim Tippen, ohne Suchknopf. Die Chips darunter
// sind die einzigen Filter: Eingang, Angeheftet und die
// meistgenutzten Tags. Ordner gibt es absichtlich nicht - ein
// ADHS-Kopf raeumt keine Ordnerbaeume auf, er sucht und verlinkt.

import { add, el, clear, relativeDate, haptic } from '../util.js';
import * as store from '../state.js';
import { excerpt } from '../md.js';
import { emptyState } from './shell.js';
import { openNote } from './editor.js';
import { openAufraeumen } from './aufraeumen.js';
import { captureBar } from './erfassen.js';

let rerenderHook = () => {};
export function setRerender(fn) {
  rerenderHook = fn;
}

// Filterzustand lebt im Modul, nicht im state: er ist fluechtig und
// soll einen App-Neustart nicht ueberleben.
const filter = { query: '', tag: null, nur: 'alle' };

/** Von aussen (Tipp auf einen #tag im Text) den Filter setzen. */
export function setFilter({ tag = null } = {}) {
  filter.query = '';
  filter.tag = tag;
  filter.nur = 'alle';
}

export const title = () => 'Notizen';

export function subtitle() {
  const count = store.activeNotes().length;
  return count === 1 ? '1 Notiz' : `${count} Notizen`;
}

export const addbar = () => captureBar('Neue Notiz oder Gedanke …');

export function render() {
  const wrap = el('div');

  // ---------- Suche ----------
  const search = el('input.search', {
    type: 'search',
    placeholder: 'Suchen …',
    value: filter.query,
  });
  search.addEventListener('input', () => {
    filter.query = search.value;
    drawList();
  });
  add(wrap, search);

  // ---------- Filter-Chips ----------
  const chips = el('div.chips', { style: { marginTop: '8px' } });
  const chip = (label, active, onClick) =>
    el('button.chip', { class: active ? 'on' : '', onclick: onClick }, label);

  const inboxCount = store.inboxNotes().length;
  add(chips,
    chip('Alle', filter.nur === 'alle' && !filter.tag, () => {
      filter.nur = 'alle';
      filter.tag = null;
      rerenderHook();
    }),
    chip(`📥 Eingang${inboxCount ? ` ${inboxCount}` : ''}`, filter.nur === 'eingang', () => {
      filter.nur = filter.nur === 'eingang' ? 'alle' : 'eingang';
      filter.tag = null;
      rerenderHook();
    }),
    chip('📌 Angeheftet', filter.nur === 'angeheftet', () => {
      filter.nur = filter.nur === 'angeheftet' ? 'alle' : 'angeheftet';
      filter.tag = null;
      rerenderHook();
    }),
    topTags().map((tag) =>
      chip(`#${tag}`, filter.tag === tag, () => {
        filter.tag = filter.tag === tag ? null : tag;
        filter.nur = 'alle';
        rerenderHook();
      })),
  );
  add(wrap, chips);

  if (filter.nur === 'eingang' && inboxCount) {
    add(wrap,
      el('button.btn.block', { style: { margin: '4px 0 10px' }, onclick: openAufraeumen },
        `Aufräumen – einer aufs Mal (${inboxCount})`),
    );
  }

  // ---------- Liste ----------
  const listWrap = el('div', { style: { marginTop: '10px' } });
  add(wrap, listWrap);

  function drawList() {
    clear(listWrap);
    const notes = filtered();

    if (!notes.length) {
      add(listWrap,
        filter.query || filter.tag || filter.nur !== 'alle'
          ? emptyState('🔍', 'Nichts gefunden.', 'Anderer Suchbegriff, anderer Filter – oder die Notiz gibt es noch nicht.')
          : emptyState('🗒', 'Noch keine Notizen.', 'Unten tippen und einfach anfangen.'));
      return;
    }

    const card = el('div.card');
    for (const note of notes.slice(0, 100)) {
      add(card,
        el('div.row.tappable', { onclick: () => openNote(note.id) },
          el('div.grow',
            el('div',
              note.angeheftet ? '📌 ' : '',
              note.typ === 'projekt' ? '🎯 ' : '',
              note.typ === 'journal' ? '📅 ' : '',
              note.titel || 'Ohne Titel',
            ),
            el('div.small.muted',
              excerpt(note.text, 70) || relativeDate(note.updatedAt),
            ),
          ),
          note.inbox ? el('span.tag', 'Eingang') : null,
          el('span.faint', '›'),
        ),
      );
    }
    add(listWrap, card);
    if (notes.length > 100) {
      add(listWrap, el('p.small.faint.center', `${notes.length - 100} weitere – Suche eingrenzen.`));
    }
  }

  drawList();
  return wrap;
}

function filtered() {
  if (filter.query.trim()) return store.searchNotes(filter.query);

  let notes = store.activeNotes();
  if (filter.nur === 'eingang') notes = notes.filter((n) => n.inbox);
  if (filter.nur === 'angeheftet') notes = notes.filter((n) => n.angeheftet);
  if (filter.tag) notes = notes.filter((n) => n.tags.includes(filter.tag));

  return notes.sort((a, b) =>
    Number(b.angeheftet) - Number(a.angeheftet)
    || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Die meistverwendeten Tags als Filterangebot. */
function topTags(limit = 6) {
  const counts = new Map();
  for (const note of store.activeNotes()) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}
