// Der Fokus-Modus: eine Sache im Blick, alles andere weg.
//
// Zwei Dinge machen ihn ADHS-tauglich. Erstens der Parkplatz: ein
// Stoergedanke wird unten abgeladen und landet im Eingang - der Kopf
// ist ihn los, ohne dass man den Fokus verlaesst. Zweitens ueberlebt
// der Fokus das Schliessen der App: wer abgelenkt wurde und die App
// wieder oeffnet, steht genau dort, wo er war.

import { add, el, clear, elapsedLabel, haptic } from '../util.js';
import * as store from '../state.js';
import { renderMarkdown } from '../md.js';
import { toast } from './shell.js';
import { openByTitle } from './editor.js';

let shownSignature = null;
let ticker = null;

/**
 * Wird von app.js bei jeder Zustandsaenderung gerufen: zeigt oder
 * versteckt das Overlay, je nachdem ob ein Fokus laeuft.
 */
export function syncOverlay() {
  const note = store.fokusNote();
  const slot = document.getElementById('fokus-slot');

  if (!note) {
    if (shownSignature) {
      shownSignature = null;
      clearInterval(ticker);
      clear(slot);
      document.body.style.overflow = '';
    }
    return;
  }

  // Nur neu zeichnen, wenn sich fuer den Fokus etwas geaendert hat.
  // Jede Zustandsaenderung (Sync-Pull, Speichern im Editor darueber)
  // loest syncOverlay aus - wuerde jedes Mal alles neu gebaut, waere
  // die halb getippte Parkplatz-Eingabe weg und die Tastatur zu.
  const fokus = store.getState().fokus;
  const signature = `${note.id}|${note.updatedAt}|${fokus.seit}|${note.naechster ?? ''}`;
  if (signature === shownSignature) return;
  shownSignature = signature;

  document.body.style.overflow = 'hidden';
  draw(slot, note);

  clearInterval(ticker);
  ticker = setInterval(() => {
    const label = document.getElementById('fokus-zeit');
    const jetzt = store.getState().fokus;
    if (label && jetzt) label.textContent = elapsedLabel(jetzt.seit);
  }, 30_000);
}

function draw(slot, note) {
  clear(slot);
  const fokus = store.getState().fokus;
  const wrap = el('div.fokus');

  // ---------- Kopf ----------
  add(wrap,
    el('div.panel-top',
      el('span.small.muted', { id: 'fokus-zeit' }, elapsedLabel(fokus.seit)),
      el('div.grow'),
      el('button.panel-btn', { onclick: () => store.endFokus() }, 'Fokus beenden'),
    ),
  );

  const scroll = el('div.panel-scroll');
  add(wrap, scroll);

  add(scroll, el('div.small.muted.center', { style: { marginTop: '4px' } }, 'Nur das hier zählt gerade:'));
  add(scroll, el('h1.note-title.center', note.titel || 'Ohne Titel'));

  // ---------- Der eine Schritt ----------
  if (note.naechster) {
    add(scroll,
      el('div.card.card-pad.fokus-step',
        el('div.small.muted', 'Nächster kleiner Schritt'),
        el('div.fokus-step-text', note.naechster),
        el('button.btn.primary.block', {
          style: { marginTop: '12px' },
          onclick: () => stepDone(note),
        }, 'Geschafft ✓'),
      ),
    );
  } else {
    add(scroll, nextStepForm(note, 'Was ist der nächste kleine Schritt?'));
  }

  // ---------- Notizinhalt zum Nachlesen ----------
  if (note.text) {
    add(scroll, el('div.section-title', 'Zum Nachlesen'));
    add(scroll,
      el('div.card.card-pad',
        renderMarkdown(note.text, {
          // Ein Link im Fokus oeffnet den Editor ueber dem Overlay -
          // kurz nachschauen, zurueck, weiter. Der Fokus bleibt an.
          onWikiLink: (titel) => openByTitle(titel),
          onTag: () => {},
        }),
      ),
    );
  }

  // ---------- Parkplatz ----------
  const park = el('input', {
    type: 'text',
    placeholder: 'Ablenkung? Hier abladen – landet im Eingang.',
  });
  const parkForm = el('form.parkbar', park,
    el('button.go', { type: 'submit', 'aria-label': 'Parken' }, '↓'));
  parkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = park.value.trim();
    if (!text) return;
    store.addCapture(text);
    park.value = '';
    haptic();
    toast('Geparkt ✓ – weiter geht’s');
  });
  add(wrap, parkForm);

  add(slot, wrap);
}

/** Schritt erledigt: in der Notiz festhalten, direkt den naechsten fragen. */
function stepDone(note) {
  haptic([10, 40, 20]);
  const done = note.naechster;
  const text = `${note.text ? `${note.text}\n` : ''}- [x] ${done}`;
  store.updateNote(note.id, { text, naechster: null });
  toast('Festgehalten ✓');
  // syncOverlay zeichnet neu und zeigt das Formular fuer den
  // naechsten Schritt - der Schwung bleibt.
}

function nextStepForm(note, frage) {
  const input = el('input', { type: 'text', placeholder: 'so klein, dass er heute machbar ist' });
  const form = el('form.card.card-pad.fokus-step',
    el('div.bold', frage),
    el('div.small.muted', { style: { margin: '4px 0 10px' } },
      'Ein Schritt, nicht drei. Danach entscheidest du neu.'),
    input,
    el('div.btn-row', { style: { margin: '12px 0 0' } },
      el('button.btn', { type: 'button', onclick: () => store.endFokus() }, 'Für heute genug'),
      el('button.btn.primary', { type: 'submit' }, 'Weiter im Fokus'),
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const schritt = input.value.trim();
    if (!schritt) return;
    store.updateNote(note.id, { naechster: schritt });
  });
  setTimeout(() => input.focus(), 60);
  return form;
}
