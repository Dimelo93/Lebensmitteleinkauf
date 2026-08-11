// Einstellungen, Haushalt, Verbindung, Datensicherung.

import { add, el } from '../util.js';
import { getConfig, setConfig, clearConfig } from '../../config.js';
import * as store from '../state.js';
import * as sync from '../sync.js';
import { toast, sheet, confirmSheet, toggleRow, field } from './shell.js';

let rerenderHook = () => {};
export function setRerender(fn) {
  rerenderHook = fn;
}

export const title = () => 'Mehr';

export function subtitle() {
  const household = store.getState().household;
  return household ? `Haushalt ${household.name}` : 'Nur auf diesem Gerät';
}

export function render() {
  const state = store.getState();
  const settings = state.settings;
  const config = getConfig();
  const wrap = el('div');

  // ---------- Haushalt ----------
  add(wrap, el('div.section-title', 'Haushalt teilen'));
  const householdCard = el('div.card');

  if (state.household) {
    add(householdCard, 
      el('div.card-pad',
        el('div.small.muted', 'Beitrittscode'),
        el('div', { style: { fontSize: '30px', fontWeight: '700', letterSpacing: '.18em', margin: '4px 0 10px', fontFamily: 'ui-monospace, monospace' } },
          state.household.joinCode ?? '––––––'),
        el('div.small.muted', { style: { marginBottom: '12px' } },
          'Schick diesen Code an alle, die dieselbe Liste sehen sollen. Sie geben ihn einmal unter "Beitreten" ein.'),
        el('div.btn-row',
          el('button.btn', {
            onclick: async () => {
              const text = `Unsere Einkaufsliste: ${location.href}\nHaushalts-Code: ${state.household.joinCode}`;
              try {
                if (navigator.share) await navigator.share({ title: 'Einkaufsliste', text });
                else {
                  await navigator.clipboard.writeText(text);
                  toast('In die Zwischenablage kopiert');
                }
              } catch {
                /* Nutzer hat abgebrochen */
              }
            },
          }, 'Teilen'),
          el('button.btn.danger', {
            onclick: async () => {
              const ok = await confirmSheet(
                'Haushalt verlassen?',
                'Die Liste bleibt auf diesem Gerät, wird aber nicht mehr abgeglichen. Mit dem Code kannst du jederzeit wieder beitreten.',
                { confirmLabel: 'Verlassen' },
              );
              if (ok) {
                await sync.leaveHousehold();
                toast('Haushalt verlassen');
                rerenderHook();
              }
            },
          }, 'Verlassen'),
        ),
      ),
    );
  } else if (config.configured) {
    add(householdCard,
      el('div.card-pad',
        el('div.small.muted', { style: { marginBottom: '12px' } },
          'Noch nicht verbunden. Leg einen Haushalt an oder tritt mit dem Code deines Partners bei.'),
        standaloneHint(),
        el('div.btn-row',
          el('button.btn.primary', { onclick: createHousehold }, 'Haushalt anlegen'),
          el('button.btn', { onclick: joinHousehold }, 'Beitreten'),
        ),
      ),
    );
  } else {
    add(householdCard,
      el('div.card-pad',
        el('div.small.muted',
          'Zum Teilen fehlt die Verbindung zu Supabase. Trag sie unten unter "Verbindung" ein — die Anleitung steht in SUPABASE.md im Projekt.'),
        standaloneHint(),
      ),
    );
  }
  add(wrap, householdCard);

  // ---------- Anzeige ----------
  add(wrap, el('div.section-title', 'Anzeige'));
  add(wrap, 
    el('div.card',
      toggleRow('Abteilungen anzeigen', 'Innerhalb eines Ladens nach Gemüse, Kühlregal, Trockenware gruppieren', settings.groupByCategory,
        (value) => store.updateSettings({ groupByCategory: value })),
      toggleRow('Preise anzeigen', 'Preisfeld pro Artikel und Summen je Laden', settings.showPrices,
        (value) => store.updateSettings({ showPrices: value })),
      toggleRow('Erledigte ausblenden', 'Abgehakte Artikel sofort verstecken statt durchgestrichen zeigen', settings.hideDone,
        (value) => store.updateSettings({ hideDone: value })),
    ),
  );

  // ---------- Budget ----------
  const budgetInput = el('input', {
    type: 'number',
    inputmode: 'decimal',
    step: '10',
    placeholder: 'kein Budget',
    value: settings.budget ?? '',
    onchange: () => {
      store.updateSettings({ budget: budgetInput.value === '' ? null : Number(budgetInput.value) });
      toast('Budget gespeichert');
    },
  });
  add(wrap, 
    el('div.section-title', 'Budget'),
    el('div.card.card-pad',
      field(`Monatsbudget in ${settings.currency}`, budgetInput),
      el('div.small.muted', { style: { marginTop: '-6px' } },
        'Wird in der Monatsübersicht und bei der Quittungs-Analyse berücksichtigt.'),
    ),
  );

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
      el('div.row.tappable', { onclick: exportData },
        el('div.grow', el('div', 'Sicherung exportieren'), el('div.small.muted', 'Alles als JSON-Datei speichern')),
        el('span.faint', '›'),
      ),
      el('div.row.tappable', { onclick: importData },
        el('div.grow', el('div', 'Sicherung einlesen'), el('div.small.muted', 'Ersetzt die Daten auf diesem Gerät')),
        el('span.faint', '›'),
      ),
      el('div.row.tappable', {
        onclick: async () => {
          const ok = await confirmSheet(
            'Alles zurücksetzen?',
            'Liste, Läden, Vorlagen, Verlauf und Preisgedächtnis auf diesem Gerät werden gelöscht. Ist ein Haushalt verbunden, holt die App sie beim nächsten Abgleich wieder vom Server.',
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

  add(wrap, 
    el('p.tiny.faint.center', { style: { padding: '10px 0 20px' } },
      'Einkaufsliste · offline nutzbar · Daten liegen auf deinem Gerät',
      state.lastPulledAt ? el('div', `zuletzt abgeglichen: ${new Date(state.lastPulledAt).toLocaleString('de-CH')}`) : null,
    ),
  );

  return wrap;
}

/**
 * Warnung vor einer Eigenheit von iOS: eine Web-App auf dem Homescreen
 * bekommt einen eigenen Speicher, getrennt von Safari. Wer die Liste
 * erst in Safari füllt und sie dann aufs Homescreen legt, findet sie
 * dort leer vor und hält das für einen Fehler. Solange kein Haushalt
 * verbunden ist, ist das tatsächlich so.
 */
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
    + 'Ohne verbundenen Haushalt sind das zwei getrennte Listen. '
    + 'Sobald ein Haushalt eingerichtet ist, zeigen beide dasselbe.',
  );
}

// ------------------------------------------------------------
// Haushalt
// ------------------------------------------------------------

function createHousehold() {
  sheet('Haushalt anlegen', (body, close) => {
    const name = el('input', { type: 'text', placeholder: 'z. B. Zuhause', value: 'Zuhause' });
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
              const household = await sync.createHousehold(name.value.trim() || 'Zuhause');
              close();
              toast(`Haushalt angelegt · Code ${household.joinCode}`);
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

function joinHousehold() {
  sheet('Haushalt beitreten', (body, close) => {
    const code = el('input', {
      type: 'text',
      placeholder: 'z. B. K4M7QP',
      autocapitalize: 'characters',
      autocomplete: 'off',
      style: { textTransform: 'uppercase', letterSpacing: '.2em', fontSize: '22px', textAlign: 'center' },
    });
    const status = el('div.small.muted');

    add(body, 
      field('Beitrittscode', code),
      el('p.small.muted', { style: { marginTop: '-6px' } },
        'Deine bisherige lokale Liste wird beim Beitreten mit hochgeladen und mit der des Haushalts zusammengeführt.'),
      status,
      el('div.btn-row',
        el('button.btn', { onclick: close }, 'Abbrechen'),
        el('button.btn.primary', {
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            status.textContent = 'Verbinde …';
            try {
              const household = await sync.joinHousehold(code.value.trim());
              close();
              toast(`Verbunden mit ${household.name}`);
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
    const key = el('input', { type: 'text', placeholder: 'eyJhbGciOi…', value: config.anonKey });
    const status = el('div.small.muted');

    add(body, 
      el('p.small.muted', { style: { marginTop: 0 } },
        'Beide Werte stehen im Supabase-Dashboard unter Project Settings → API. Der anon key ist für den Browser gedacht und darf hier stehen; den service_role key niemals eintragen.'),
      field('Projekt-URL', url),
      field('anon key', key),
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

function exportData() {
  const state = store.getState();
  const payload = {
    exportiert: new Date().toISOString(),
    version: state.version,
    stores: state.stores,
    items: state.items,
    staples: state.staples,
    memory: state.memory,
    trips: state.trips,
    receipts: state.receipts,
    settings: state.settings,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', {
    href: url,
    download: `einkaufsliste-${new Date().toISOString().slice(0, 10)}.json`,
  });
  add(document.body, link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Sicherung erstellt');
}

function importData() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const ok = await confirmSheet(
        'Sicherung einlesen?',
        'Die Daten auf diesem Gerät werden durch die Sicherung ersetzt.',
        { confirmLabel: 'Einlesen', danger: false },
      );
      if (!ok) return;

      // Die Haushaltsverbindung überlebt den Import - sonst wäre das
      // Gerät nach dem Einlesen aus dem geteilten Haushalt gefallen.
      const household = store.getState().household;

      store.resetAll();
      const state = store.getState();
      for (const key of ['stores', 'items', 'staples', 'trips', 'receipts']) {
        if (Array.isArray(parsed[key])) state[key] = parsed[key];
      }
      if (parsed.memory && typeof parsed.memory === 'object') state.memory = parsed.memory;
      if (parsed.settings) Object.assign(state.settings, parsed.settings);

      // setHousehold markiert zugleich alles als ausstehend, damit die
      // eingelesenen Daten beim nächsten Abgleich hochgehen.
      store.setHousehold(household);
      toast('Sicherung eingelesen');
      rerenderHook();
    } catch (err) {
      toast('Datei konnte nicht gelesen werden');
    } finally {
      input.remove();
    }
  });
  add(document.body, input);
  input.click();
}
