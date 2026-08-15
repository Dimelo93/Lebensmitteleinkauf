// Die Erfassen-Leiste: der kuerzeste Weg vom Gedanken in die App.
//
// Ein Feld, ein Knopf, keine Rueckfrage. Der Text landet im Eingang;
// Titel und Tags ergeben sich von selbst (state.addCapture). Mehr
// darf Erfassen nicht kosten, sonst unterbleibt es.

import { el, haptic } from '../util.js';
import * as store from '../state.js';
import { toast } from './shell.js';

/**
 * @param {string} placeholder
 * @param {object} opts  typ: 'notiz' | 'projekt', hinweis: Text unter dem Feld
 */
export function captureBar(placeholder, { typ = 'notiz', hinweis = null } = {}) {
  const input = el('input', {
    type: 'text',
    placeholder,
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
  });
  const go = el('button.go', { type: 'submit', 'aria-label': 'Erfassen' }, '+');
  const form = el('form', input, go);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const note = store.addCapture(text, { typ });
    input.value = '';
    // Fokus bleibt im Feld: der naechste Gedanke kommt oft gleich
    // hinterher.
    input.focus();
    haptic();
    if (note) {
      toast(typ === 'projekt' ? `Projekt «${note.titel}» angelegt` : 'Im Eingang ✓');
    }
  });

  const bar = el('div.addbar', form);
  if (hinweis) bar.prepend(el('div.hint-row', hinweis));
  return bar;
}
