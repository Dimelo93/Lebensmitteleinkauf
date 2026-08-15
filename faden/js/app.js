// Startpunkt: Zustand laden, Ansichten verdrahten, Abgleich starten.

import { add, el, clear, debounce } from './util.js';
import * as store from './state.js';
import * as sync from './sync.js';
import { toast } from './ui/shell.js';
import { openNote, setTagHandler } from './ui/editor.js';
import * as fokus from './ui/fokus.js';

import * as heute from './ui/heute.js';
import * as notizen from './ui/notizen.js';
import * as projekte from './ui/projekte.js';
import * as fragen from './ui/fragen.js';
import * as mehr from './ui/mehr.js';

const TABS = [
  { id: 'heute', icon: '🧵', label: 'Heute', view: heute },
  { id: 'notizen', icon: '🗒', label: 'Notizen', view: notizen },
  { id: 'projekte', icon: '🎯', label: 'Projekte', view: projekte },
  { id: 'fragen', icon: '💬', label: 'Fragen', view: fragen },
  { id: 'mehr', icon: '⚙️', label: 'Mehr', view: mehr },
];

let current = 'heute';
let addbarSignature = null;

const nodes = {
  title: document.getElementById('title'),
  subtitle: document.getElementById('subtitle'),
  view: document.getElementById('view'),
  tabbar: document.getElementById('tabbar'),
  fadenSlot: document.getElementById('faden-slot'),
  addbarSlot: document.getElementById('addbar-slot'),
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
};

// ------------------------------------------------------------
// Zeichnen
// ------------------------------------------------------------

function activeTab() {
  return TABS.find((tab) => tab.id === current) ?? TABS[0];
}

function renderTabs() {
  clear(nodes.tabbar);
  for (const tab of TABS) {
    add(nodes.tabbar,
      el('button', {
        'aria-current': tab.id === current ? 'page' : null,
        onclick: () => go(tab.id),
      },
        el('span.ico', tab.icon),
        el('span', tab.label),
      ),
    );
  }
}

function render() {
  const tab = activeTab();

  nodes.title.firstChild.textContent = tab.view.title();
  nodes.subtitle.textContent = tab.view.subtitle();

  clear(nodes.view);
  add(nodes.view, tab.view.render());

  // Die Eingabeleiste wird bewusst nicht bei jedem Zustandswechsel neu
  // gebaut - sonst verlierst du beim Tippen Text und Fokus.
  if (tab.id !== addbarSignature) {
    addbarSignature = tab.id;
    clear(nodes.addbarSlot);
    if (tab.view.addbar) add(nodes.addbarSlot, tab.view.addbar());
  }

  renderFadenBar();
  fokus.syncOverlay();
  scheduleMeasure();
}

const scheduleRender = debounce(render, 16);

/**
 * Die "Zurück zu"-Leiste: das sichtbare Ende des Fadens.
 *
 * Wer per Link, Suche oder Ablenkung weitergesprungen ist, sieht hier
 * immer, wo er herkam - ein Tipp, und er ist wieder dort. Die Leiste
 * ist bewusst schmal und immer am selben Ort: sie soll beruhigen,
 * nicht rufen.
 */
function renderFadenBar() {
  clear(nodes.fadenSlot);
  const prev = store.previousStop();
  if (!prev) return;

  add(nodes.fadenSlot,
    el('button.faden-bar', {
      onclick: () => {
        const target = store.stepBack();
        if (target) openNote(target.id);
      },
    },
      el('span.faden-ico', '‹'),
      el('span.grow.nowrap', `Zurück zu: ${prev.titel || 'Ohne Titel'}`),
    ),
  );
}

/**
 * Höhen der festen Leisten als CSS-Variablen bereitstellen - die
 * Kopfzeile ist je nach Gerät (Notch) und Ansicht unterschiedlich hoch.
 */
function measureChrome() {
  const root = document.documentElement.style;
  root.setProperty('--topbar-h', `${Math.round(document.querySelector('.topbar').offsetHeight)}px`);
  root.setProperty('--addbar-h', `${Math.round(nodes.addbarSlot.offsetHeight + nodes.fadenSlot.offsetHeight)}px`);
  root.setProperty('--tabbar-h', `${Math.round(nodes.tabbar.offsetHeight)}px`);
}

const scheduleMeasure = debounce(measureChrome, 60);

function go(id) {
  if (current === id) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  current = id;
  history.replaceState(null, '', `#${id}`);
  renderTabs();
  render();
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------
// Verbindungsanzeige
// ------------------------------------------------------------

const STATUS_LABEL = {
  local: { text: 'Nur hier', css: '' },
  connecting: { text: 'Verbinde …', css: '' },
  ready: { text: 'Verbunden', css: 'online' },
  online: { text: 'Synchron', css: 'online' },
  offline: { text: 'Offline', css: 'offline' },
  error: { text: 'Fehler', css: 'error' },
};

let letzterStatus = null;

function paintStatus(status) {
  const info = STATUS_LABEL[status.state] ?? STATUS_LABEL.local;
  const pending = store.outboxSize();

  letzterStatus = status;
  nodes.status.hidden = false;
  nodes.status.className = `status ${info.css}`.trim();
  nodes.statusText.textContent = pending > 0 && status.state !== 'online'
    ? `${info.text} · ${pending}`
    : info.text;
  nodes.status.title = status.detail ?? '';
}

nodes.status.addEventListener('click', () => {
  const detail = letzterStatus?.detail;
  if (detail) toast(detail, { ms: 9000 });
});

// ------------------------------------------------------------
// Service Worker
// ------------------------------------------------------------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  try {
    // Uebernimmt ein neuer Service Worker, ist der geladene Code von
    // gestern. Einmal neu laden, dann passt beides zusammen.
    // Begruendung im Detail: js/app.js der Einkaufsliste.
    const hatteController = Boolean(navigator.serviceWorker.controller);
    let laedtNeu = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (laedtNeu || !hatteController) return;
      laedtNeu = true;
      location.reload();
    });

    const registration = await navigator.serviceWorker.register('sw.js');
    registration.update().catch(() => {});

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Neue Version wird geladen …', { ms: 4000 });
        }
      });
    });
  } catch (err) {
    console.warn('Service Worker nicht registriert', err);
  }
}

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

function boot() {
  store.load();

  // Rückkanal für Ansichten, die eigenen Zustand halten.
  notizen.setRerender(render);
  fragen.setRerender(render);
  mehr.setRerender(render);

  // Ein Tipp auf einen #tag fuehrt in die Notizen-Ansicht mit
  // gesetztem Filter - der Editor und Heute kennen die Tabs nicht.
  const tagZuNotizen = (tag) => {
    notizen.setFilter({ tag });
    go('notizen');
    render();
  };
  setTagHandler(tagZuNotizen);
  heute.setTagHandler(tagZuNotizen);

  const fromHash = location.hash.replace('#', '');
  if (TABS.some((tab) => tab.id === fromHash)) current = fromHash;

  renderTabs();
  render();
  measureChrome();
  window.addEventListener('resize', scheduleMeasure);
  window.addEventListener('orientationchange', scheduleMeasure);

  store.subscribe(scheduleRender);
  sync.onStatus(paintStatus);
  sync.installListeners();
  sync.connect();

  registerServiceWorker();

  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (TABS.some((tab) => tab.id === id) && id !== current) go(id);
  });

  // Beim Zurückkehren in die App den Bildschirm auffrischen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRender();
  });

  // Lief beim letzten Schliessen ein Fokus, steht er sofort wieder da:
  // "Du warst hier." Genau der Moment, in dem der rote Faden sonst
  // reissen wuerde.
  if (store.getState().fokus) {
    fokus.syncOverlay();
    toast('Weiter, wo du warst.');
  }
}

boot();
