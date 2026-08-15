// Fragen: der Chat mit dem eigenen zweiten Hirn.
//
// Jede Frage kostet einen API-Aufruf (ein paar Rappen). Die Antwort
// stuetzt sich nur auf die eigenen Notizen und nennt ihre Quellen -
// jede Quelle ist antippbar und oeffnet die Notiz.

import { add, el, haptic } from '../util.js';
import * as store from '../state.js';
import { getConfig } from '../../config.js';
import * as chat from '../chat.js';
import { toast, emptyState, confirmSheet } from './shell.js';
import { openByTitle } from './editor.js';

let rerenderHook = () => {};
export function setRerender(fn) {
  rerenderHook = fn;
}

// Laeuft gerade eine Anfrage? Lebt im Modul: der Zustand ist
// fluechtig und gehoert nicht in den gespeicherten State.
let denkt = false;

export const title = () => 'Fragen';

export function subtitle() {
  return denkt ? 'denkt nach …' : 'Antworten aus deinen Notizen';
}

export function addbar() {
  const input = el('input', {
    type: 'text',
    placeholder: 'Frag dein Hirn: Was weiss ich über …?',
    autocomplete: 'off',
    enterkeyhint: 'send',
  });
  const go = el('button.go', { type: 'submit', 'aria-label': 'Fragen' }, '↑');
  const form = el('form', input, go);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || denkt) return;

    input.value = '';
    haptic();
    store.addChatMessage({ rolle: 'ich', text });

    denkt = true;
    rerenderHook();
    try {
      const ergebnis = await chat.frage(text);
      store.addChatMessage({
        rolle: 'hirn',
        text: ergebnis?.antwort || 'Dazu steht nichts in deinen Notizen.',
        quellen: Array.isArray(ergebnis?.quellen) ? ergebnis.quellen : [],
      });
    } catch (err) {
      store.addChatMessage({ rolle: 'hirn', text: err.message || 'Das hat nicht geklappt.', fehler: true });
    } finally {
      denkt = false;
      rerenderHook();
    }
  });

  return el('div.addbar', form);
}

export function render() {
  const wrap = el('div');
  const config = getConfig();
  const messages = store.getState().chat;

  if (!config.configured) {
    add(wrap, emptyState('🔌', 'Noch nicht verbunden.',
      'Der Chat braucht die Supabase-Verbindung und die Edge Function faden-chat. Einrichtung: Mehr → Verbindung, Anleitung im README.'));
    return wrap;
  }

  if (!messages.length) {
    add(wrap, emptyState('💬', 'Frag dein zweites Hirn.',
      'Zum Beispiel: «Was weiss ich über die Wohnungssuche?» oder «Welche Ideen hatte ich diese Woche?» '
      + 'Jede Frage ist ein API-Aufruf und kostet ein paar Rappen.'));
    return wrap;
  }

  const list = el('div.chat-list');
  for (const message of messages) {
    const bubble = el(`div.bubble.${message.rolle === 'ich' ? 'me' : 'brain'}`, { class: message.fehler ? 'fail' : '' });
    // Antworten sind Klartext; Notiztitel darin sollen springbar sein.
    add(bubble, linkifyTitles(message.text));
    if (message.quellen?.length) {
      const row = el('div.quellen');
      for (const titel of message.quellen) {
        add(row, el('button.chip', { onclick: () => openByTitle(titel) }, `[[${titel}]]`));
      }
      add(bubble, row);
    }
    add(list, bubble);
  }
  if (denkt) {
    add(list, el('div.bubble.brain', el('span.spinner'), ' liest deine Notizen …'));
  }
  add(wrap, list);

  add(wrap,
    el('p.center', { style: { margin: '16px 0' } },
      el('button.btn', {
        onclick: async () => {
          const ok = await confirmSheet('Verlauf löschen?',
            'Nur das Gespräch hier wird gelöscht, keine Notizen.', { confirmLabel: 'Löschen' });
          if (ok) {
            store.clearChat();
            toast('Verlauf gelöscht');
          }
        },
      }, 'Verlauf löschen'),
    ),
  );

  // Beim Zeichnen ans Ende springen - das Neueste gehoert ins Bild.
  queueMicrotask(() => window.scrollTo({ top: document.body.scrollHeight }));
  return wrap;
}

/** [[Titel]] in der Antwort anklickbar machen. */
function linkifyTitles(text) {
  const out = [];
  let rest = String(text ?? '');
  const re = /\[\[([^\[\]\n]+?)\]\]/;
  while (rest) {
    const match = re.exec(rest);
    if (!match) {
      out.push(rest);
      break;
    }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const titel = match[1].trim();
    out.push(el('a.wikilink', {
      href: '#',
      onclick: (event) => {
        event.preventDefault();
        openByTitle(titel);
      },
    }, titel));
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}
