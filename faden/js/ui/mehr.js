// Einstellungen, Sync-Raum, Verbindung, Datensicherung, Diagnose.
// Aufbau wie in der Einkaufsliste (js/ui/mehr.js), angepasst auf den
// Sync-Raum von Faden.

import { add, el, clear } from '../util.js';
import { getConfig, setConfig, clearConfig } from '../../config.js';
import { BUILD } from '../version.js';
import * as store from '../state.js';
import * as sync from '../sync.js';
import { toast, sheet, confirmSheet, field } from './shell.js';

let rerenderHook = () => {};
export function setRerender(fn) {
  rerenderHook = fn;
}

export const title = () => 'Mehr';

export function subtitle() {
  const raum = store.getState().raum;
  return raum ? `Sync-Raum ${raum.name}` : 'Nur auf diesem Gerät';
}

export function render() {
  const state = store.getState();
  const config = getConfig();
  const wrap = el('div');

  // ---------- Sync-Raum ----------
  add(wrap, el('div.section-title', 'Geräte verbinden'));
  const raumCard = el('div.card');

  if (state.raum) {
    add(raumCard,
      el('div.card-pad',
        el('div.small.muted', 'Sync-Code'),
        el('div', { style: { fontSize: '30px', fontWeight: '700', letterSpacing: '.18em', margin: '4px 0 10px', fontFamily: 'ui-monospace, monospace' } },
          state.raum.joinCode ?? '––––––'),
        el('div.small.muted', { style: { marginBottom: '12px' } },
          'Gib diesen Code auf deinem anderen Gerät ein (iPhone ↔ Laptop), dann zeigen beide dieselben Notizen. '
          + 'Der Code ist der Schlüssel zu deinen Notizen – nur auf eigenen Geräten eingeben.'),
        el('div.btn-row',
          el('button.btn', {
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(state.raum.joinCode);
                toast('Code kopiert');
              } catch {
                toast('Kopieren ging nicht — Code von Hand notieren');
              }
            },
          }, 'Code kopieren'),
          el('button.btn.danger', {
            onclick: async () => {
              const ok = await confirmSheet(
                'Raum verlassen?',
                'Die Notizen bleiben auf diesem Gerät, werden aber nicht mehr abgeglichen. Mit dem Code kannst du jederzeit wieder beitreten.',
                { confirmLabel: 'Verlassen' },
              );
              if (ok) {
                await sync.leaveRaum();
                toast('Raum verlassen');
                rerenderHook();
              }
            },
          }, 'Verlassen'),
        ),
      ),
    );
  } else if (config.configured) {
    add(raumCard,
      el('div.card-pad',
        el('div.small.muted', { style: { marginBottom: '12px' } },
          'Noch nicht verbunden. Leg einen Sync-Raum an (erstes Gerät) oder tritt mit dem Code deines anderen Geräts bei.'),
        verbindungsFehler(),
        standaloneHint(),
        el('div.btn-row',
          el('button.btn.primary', { onclick: createRaum }, 'Raum anlegen'),
          el('button.btn', { onclick: joinRaum }, 'Beitreten'),
        ),
      ),
    );
  } else {
    add(raumCard,
      el('div.card-pad',
        el('div.small.muted',
          'Zum Abgleich zwischen iPhone und Laptop fehlt die Verbindung zu Supabase. Trag sie unten unter "Verbindung" ein — die Anleitung steht im README von faden/.'),
        standaloneHint(),
      ),
    );
  }
  add(wrap, raumCard);

  // ---------- Verbindung ----------
  add(wrap, el('div.section-title', 'Verbindung'));
  add(wrap,
    el('div.card',
      el('div.row.tappable', { onclick: connectionSheet },
        el('div.grow',
          el('div', 'Supabase'),
          el('div.small.muted', config.configured ? config.url.replace(/^https?:\/\//, '') : 'nicht eingerichtet'),
        ),
        el('span.faint', '›'),
      ),
      el('div.row',
        el('div.grow',
          el('div', 'Ausstehende Änderungen'),
          el('div.small.muted', 'Warten auf die nächste Verbindung'),
        ),
        el('div.bold', String(store.outboxSize())),
      ),
    ),
  );

  // ---------- Daten ----------
  add(wrap, el('div.section-title', 'Daten'));
  add(wrap,
    el('div.card',
      el('div.row.tappable', { onclick: exportJson },
        el('div.grow', el('div', 'Sicherung exportieren'), el('div.small.muted', 'Alle Notizen als JSON-Datei')),
        el('span.faint', '›'),
      ),
      el('div.row.tappable', { onclick: exportMarkdown },
        el('div.grow', el('div', 'Markdown exportieren'), el('div.small.muted', 'Eine .md-Datei, auch für Obsidian lesbar')),
        el('span.faint', '›'),
      ),
      el('div.row.tappable', { onclick: importJson },
        el('div.grow', el('div', 'Sicherung einlesen'), el('div.small.muted', 'Ersetzt die Notizen auf diesem Gerät')),
        el('span.faint', '›'),
      ),
      el('div.row.tappable', { onclick: frischLaden },
        el('div.grow',
          el('div', 'App auffrischen'),
          el('div.small.muted', 'Programmdateien neu laden, wenn eine Neuerung fehlt'),
        ),
        el('span.faint', '›'),
      ),
      el('div.row.tappable', {
        onclick: async () => {
          const ok = await confirmSheet(
            'Alles zurücksetzen?',
            'Alle Notizen, Projekte, der Faden und der Chat auf diesem Gerät werden gelöscht. Ist ein Sync-Raum verbunden, holt die App die Notizen beim nächsten Abgleich wieder vom Server.',
            { confirmLabel: 'Zurücksetzen' },
          );
          if (ok) {
            store.resetAll();
            toast('Zurückgesetzt');
          }
        },
      },
        el('div.grow', el('div', { style: { color: 'var(--danger)' } }, 'Alles zurücksetzen')),
      ),
    ),
  );

  // ---------- Diagnose ----------
  add(wrap, el('div.section-title', 'Diagnose'));
  add(wrap, diagnoseCard());

  add(wrap,
    el('p.tiny.faint.center', { style: { padding: '10px 0 20px' } },
      'Faden · dein zweites Hirn · offline nutzbar · Daten liegen auf deinem Gerät',
      state.lastPulledAt ? el('div', `zuletzt abgeglichen: ${new Date(state.lastPulledAt).toLocaleString('de-CH')}`) : null,
    ),
  );

  return wrap;
}

function diagnoseCard() {
  const card = el('div.card.card-pad');
  const lines = el('div.small.muted', { style: { lineHeight: '1.7' } }, 'Wird geprüft …');

  let text = '';

  add(card, lines,
    el('div.btn-row', { style: { marginTop: '12px' } },
      el('button.btn', {
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          await sync.reconnect();
          button.disabled = false;
          toast('Verbindung neu aufgebaut');
          rerenderHook();
        },
      }, 'Neu verbinden'),
      el('button.btn', {
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast('Diagnose kopiert');
          } catch {
            toast('Kopieren ging nicht — Text von Hand markieren');
          }
        },
      }, 'Kopieren'),
    ),
  );

  (async () => {
    const report = await sync.diagnose();
    const zwischenspeicher = await cacheNamen();
    const zeilen = [
      ['Version (Code)', BUILD],
      ['Version (Speicher)', zwischenspeicher],
      ['Server', report.url],
      ['Schlüssel', report.schluessel],
      ['Zugangsdaten', report.quelle],
      ['Bibliothek', report.bibliothek],
      ['Anmeldung', report.sitzung],
      ['Status', report.status],
    ];
    text = zeilen.map(([k, v]) => `${k}: ${v}`).join('\n');

    clear(lines);
    for (const [k, v] of zeilen) {
      add(lines, el('div', el('span.bold', `${k}: `), String(v)));
    }
    if (BUILD !== zwischenspeicher && zwischenspeicher !== '(keiner)') {
      add(lines, el('div', { style: { marginTop: '8px', color: 'var(--danger)' } },
        'Code und Speicher sind verschieden — es läuft noch eine alte Fassung. '
        + 'Oben auf "App auffrischen" tippen.'));
    }
  })();

  return card;
}

/** Welche Fassung liegt im Zwischenspeicher des Service Workers? */
async function cacheNamen() {
  if (!('caches' in window)) return '(keiner)';
  try {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('faden-') && k.endsWith('-shell'));
    return shell ? shell.replace('faden-', '').replace('-shell', '') : '(keiner)';
  } catch {
    return '(nicht lesbar)';
  }
}

/** Ausweg aus einem festgefahrenen Zwischenspeicher - siehe Einkaufsliste. */
async function frischLaden() {
  const ok = await confirmSheet(
    'App-Speicher auffrischen?',
    'Die zwischengespeicherten Programmdateien werden verworfen und frisch geladen. Deine Notizen bleiben unberührt.',
    { confirmLabel: 'Auffrischen' },
  );
  if (!ok) return;

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      // Nur die eigenen Zwischenspeicher: die Einkaufsliste auf
      // derselben Domain behaelt ihre.
      await Promise.all(keys.filter((k) => k.startsWith('faden-')).map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('Auffrischen unvollständig', err);
  }
  location.replace(`${location.pathname}?frisch=${Date.now()}${location.hash}`);
}

function verbindungsFehler() {
  const status = sync.getStatus();
  if (status.state !== 'error' || !status.detail) return null;

  return el('div.small', {
    style: {
      marginBottom: '12px',
      padding: '10px 12px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-sunken)',
      color: 'var(--danger)',
    },
  }, el('span.bold', 'Verbindung: '), status.detail);
}

function standaloneHint() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!apple) return null;

  return el('div.small', {
    style: {
      marginTop: '12px',
      padding: '10px 12px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-sunken)',
      color: 'var(--text-dim)',
    },
  },
    el('span.bold', standalone ? 'Fehlt hier etwas? ' : 'Bevor du sie auf den Homescreen legst: '),
    'Auf dem iPhone hat die App auf dem Homescreen einen eigenen Speicher, getrennt von Safari. '
    + 'Ohne verbundenen Sync-Raum sind das zwei getrennte Notizbestände. '
    + 'Sobald der Raum eingerichtet ist, zeigen beide dasselbe.',
  );
}

// ------------------------------------------------------------
// Sync-Raum anlegen / beitreten
// ------------------------------------------------------------

function createRaum() {
  sheet('Sync-Raum anlegen', (body, close) => {
    const name = el('input', { type: 'text', placeholder: 'z. B. Mein Faden', value: 'Mein Faden' });
    const status = el('div.small.muted');

    add(body,
      field('Name', name),
      status,
      el('div.btn-row',
        el('button.btn', { onclick: close }, 'Abbrechen'),
        el('button.btn.primary', {
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            status.textContent = 'Wird angelegt …';
            try {
              const raum = await sync.createRaum(name.value.trim() || 'Mein Faden');
              close();
              toast(`Raum angelegt · Code ${raum.joinCode}`);
              rerenderHook();
            } catch (err) {
              status.textContent = err.message;
              button.disabled = false;
            }
          },
        }, 'Anlegen'),
      ),
    );
  });
}

function joinRaum() {
  sheet('Sync-Raum beitreten', (body, close) => {
    const code = el('input', {
      type: 'text',
      placeholder: 'z. B. K4M7QP',
      autocapitalize: 'characters',
      autocomplete: 'off',
      style: { textTransform: 'uppercase', letterSpacing: '.2em', fontSize: '22px', textAlign: 'center' },
    });
    const status = el('div.small.muted');

    add(body,
      field('Sync-Code', code),
      el('p.small.muted', { style: { marginTop: '-6px' } },
        'Die Notizen auf diesem Gerät werden beim Beitreten mit hochgeladen und mit dem Bestand des Raums zusammengeführt.'),
      status,
      el('div.btn-row',
        el('button.btn', { onclick: close }, 'Abbrechen'),
        el('button.btn.primary', {
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            status.textContent = 'Verbinde …';
            try {
              const raum = await sync.joinRaum(code.value.trim());
              close();
              toast(`Verbunden mit ${raum.name}`);
              rerenderHook();
            } catch (err) {
              status.textContent = err.message;
              button.disabled = false;
            }
          },
        }, 'Beitreten'),
      ),
    );
  });
}

// ------------------------------------------------------------
// Verbindung
// ------------------------------------------------------------

function connectionSheet() {
  const config = getConfig();

  sheet('Supabase-Verbindung', (body, close) => {
    const url = el('input', { type: 'url', placeholder: 'https://xxxx.supabase.co', value: config.url });
    const key = el('input', { type: 'text', placeholder: 'sb_publishable_… oder eyJhbGciOi…', value: config.anonKey });
    const status = el('div.small.muted');

    add(body,
      el('p.small.muted', { style: { marginTop: 0 } },
        'Beide Werte stehen im Supabase-Dashboard unter Project Settings → API Keys. Der öffentliche Schlüssel (Publishable bzw. anon) ist für den Browser gedacht und darf hier stehen; den geheimen Schlüssel (Secret bzw. service_role) niemals eintragen.'),
      field('Projekt-URL', url),
      field('Öffentlicher Schlüssel', key),
      status,
      el('div.btn-row',
        el('button.btn.danger', {
          onclick: () => {
            clearConfig();
            close();
            toast('Verbindung entfernt');
            rerenderHook();
          },
        }, 'Entfernen'),
        el('button.btn.primary', {
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            status.textContent = 'Teste Verbindung …';
            setConfig({ url: url.value.trim(), anonKey: key.value.trim() });
            const client = await sync.connect();
            if (client) {
              close();
              toast('Verbunden');
              rerenderHook();
            } else {
              status.textContent = sync.getStatus().detail || 'Verbindung fehlgeschlagen';
              button.disabled = false;
            }
          },
        }, 'Speichern'),
      ),
    );
  });
}

// ------------------------------------------------------------
// Sicherung
// ------------------------------------------------------------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  add(document.body, link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportJson() {
  const state = store.getState();
  const payload = {
    exportiert: new Date().toISOString(),
    version: state.version,
    notizen: state.notizen,
    settings: state.settings,
  };
  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `faden-${new Date().toISOString().slice(0, 10)}.json`,
  );
  toast('Sicherung erstellt');
}

/**
 * Alle Notizen als eine Markdown-Datei - mit denselben [[Links]] und
 * #tags, sodass Obsidian oder jeder Editor sie lesen kann. Kein
 * Einsperren: die Notizen gehoeren dem Nutzer, nicht der App.
 */
function exportMarkdown() {
  const parts = [];
  for (const note of store.activeNotes()) {
    const kopf = [`# ${note.titel || 'Ohne Titel'}`];
    const meta = [];
    if (note.typ !== 'notiz') meta.push(note.typ);
    if (note.naechster) meta.push(`nächster Schritt: ${note.naechster}`);
    meta.push(`geändert ${String(note.updatedAt).slice(0, 10)}`);
    kopf.push(`*${meta.join(' · ')}*`);
    parts.push(`${kopf.join('\n')}\n\n${note.text || ''}`.trim());
  }
  download(
    new Blob([parts.join('\n\n---\n\n')], { type: 'text/markdown' }),
    `faden-${new Date().toISOString().slice(0, 10)}.md`,
  );
  toast('Markdown exportiert');
}

function importJson() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.notizen)) throw new Error('keine Notizen in der Datei');
      const ok = await confirmSheet(
        'Sicherung einlesen?',
        `${parsed.notizen.length} Notizen ersetzen die Daten auf diesem Gerät.`,
        { confirmLabel: 'Einlesen', danger: false },
      );
      if (!ok) return;

      // Die Raumverbindung ueberlebt den Import - sonst waere das
      // Geraet nach dem Einlesen aus dem Sync gefallen.
      const raum = store.getState().raum;

      store.resetAll();
      const state = store.getState();
      state.notizen = parsed.notizen;
      if (parsed.settings) Object.assign(state.settings, parsed.settings);

      // setRaum markiert zugleich alles als ausstehend, damit die
      // eingelesenen Notizen beim naechsten Abgleich hochgehen.
      store.setRaum(raum);
      toast('Sicherung eingelesen');
      rerenderHook();
    } catch (err) {
      toast(`Datei konnte nicht gelesen werden${err.message ? ` (${err.message})` : ''}`);
    } finally {
      input.remove();
    }
  });
  add(document.body, input);
  input.click();
}
